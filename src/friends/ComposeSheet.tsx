/**
 * ComposeSheet — "Cinkni partě" compose (Parta 3.0 §B2).
 *
 * The main verb, finally on-screen. A clone of the FriendSettingsSheet scaffold
 * hosting three stacked sections on the bare stout ground:
 *   KDE  — a Poblíž / Nedávné segmented picker over a hairline pub list.
 *   KDY  — Teď (immediate live broadcast) / Na čas (a scheduled plan with preset
 *          hour chips + the HourStepper fallback).
 *   VZKAZ — an optional short message (replaces the old hardcoded atPubMessage).
 * A sticky primary CTA ("Cinknout" / "Naplánovat") submits.
 *
 * Offline-first: a transient failure routes the broadcast/plan through
 * friendsQueue so it survives bar wifi; a hard reject keeps the sheet open with
 * its data. The nearby GPS watcher only runs while the sheet is open, because the
 * parent mounts this component only when open (privacy + battery).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, MapPinIcon, PlusIcon, UsersIcon, XIcon } from '@/components/shared/IconGlyph';
import { Toast } from '@/components/shared/Toast';
import { generateUuidV4 } from '@/data/account';
import { decodeGeohash8 } from '@/data/geohash';
import {
  createFriendPlan,
  shareFriendPubActivity,
  type FriendActionResult,
  type FriendProfile,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import type { Pub } from '@/data/pubs';
import { useNearbyPub } from '@/counter/useNearbyPub';
import { cs } from '@/i18n/cs';
import { usePartyGroupsStore } from '@/stores/partyGroupsStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

import HourStepper from './HourStepper';
import { friendDisplayName } from './FriendMini';
import SectionHeader from './SectionHeader';
import SegmentedControl from './SegmentedControl';
import SkeletonBlock from './SkeletonBlock';

const SLIDE_SPRING = { damping: 18, stiffness: 180, mass: 0.9 } as const;
const MESSAGE_MAX = 80;
const HOUR_PRESETS = [18, 19, 20, 21, 22] as const;
const RECENT_LIMIT = 6;

interface ComposeSheetProps {
  /** Accepted friends available as recipients. */
  friends: FriendProfile[];
  /** Fired after a successful (or queued) send so the parent reloads. */
  onSubmitted: () => void;
  /** Fired once the sheet has finished sliding out (parent then unmounts it). */
  onClose: () => void;
}

interface PubOption {
  key: string;
  pub: Pub;
  distanceMeters: number | null;
}

/** A pub row in the KDE picker (name + city + distance, amber tint when chosen). */
function PubRow({
  option,
  selected,
  onSelect,
}: {
  option: PubOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [styles.pubRow, selected && styles.pubRowSelected, pressed && styles.dim]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={option.pub.name}
    >
      <MapPinIcon size={18} color={selected ? Colors.amber : Colors.mutedText} />
      <View style={styles.pubRowText}>
        <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {option.pub.name}
        </Text>
        {option.pub.city ? (
          <Text style={styles.pubCity} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {option.pub.city}
          </Text>
        ) : null}
      </View>
      {option.distanceMeters != null ? (
        <Text style={styles.pubDistance} allowFontScaling={false}>
          {cs.friends.composeMeters(Math.round(option.distanceMeters))}
        </Text>
      ) : null}
      {selected ? <CheckIcon size={18} color={Colors.amber} /> : null}
    </Pressable>
  );
}

function RecipientChip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.recipientChip,
        selected && styles.recipientChipActive,
        pressed && styles.dim,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      {icon}
      <Text
        style={[styles.recipientChipText, selected && styles.recipientChipTextActive]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FriendRecipientRow({
  friend,
  selected,
  onToggle,
}: {
  friend: FriendProfile;
  selected: boolean;
  onToggle: () => void;
}) {
  const name = friendDisplayName(friend);
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.recipientRow,
        selected && styles.recipientRowSelected,
        pressed && styles.dim,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
    >
      <View style={[styles.recipientCheck, selected && styles.recipientCheckActive]}>
        {selected ? <CheckIcon size={14} color={Colors.stout} /> : null}
      </View>
      <View style={styles.recipientNameWrap}>
        <Text style={styles.recipientName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {name}
        </Text>
        {friend.displayName && friend.nickname ? (
          <Text style={styles.recipientSub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {friend.displayName}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ComposeSheet({ friends, onSubmitted, onClose }: ComposeSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);

  const { candidates, permissionState, requestPermission, loading } = useNearbyPub();
  const groups = usePartyGroupsStore((s) => s.groups);
  const upsertGroup = usePartyGroupsStore((s) => s.upsertGroup);
  const pruneMemberIds = usePartyGroupsStore((s) => s.pruneMemberIds);

  const [placeTab, setPlaceTab] = useState<0 | 1>(0);
  const [timeTab, setTimeTab] = useState<0 | 1>(0);
  const [audienceMode, setAudienceMode] = useState<'all' | 'custom'>('all');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedPub, setSelectedPub] = useState<Pub | null>(null);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Lazy-read the clock once (a useState initializer is not a render-time impure
  // call). The plan can only target a future hour today.
  const [nowHour] = useState(() => new Date().getHours());
  const minHour = nowHour + 1;
  const availablePresets = useMemo(() => HOUR_PRESETS.filter((h) => h >= minHour), [minHour]);
  const [hour, setHour] = useState<number>(() => {
    const nh = new Date().getHours();
    return HOUR_PRESETS.find((h) => h >= nh + 1) ?? Math.min(nh + 1, 23);
  });

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const nearbyOptions = useMemo<PubOption[]>(
    () =>
      candidates.map((c) => ({
        key: c.pubKey,
        pub: c.pub,
        distanceMeters: c.distanceMeters,
      })),
    [candidates],
  );

  // Recent pubs from the local tally (current + history), deduped by geohash cell.
  const tallyCurrent = useTallyStore((s) => s.current);
  const tallyHistory = useTallyStore((s) => s.history);
  const recentOptions = useMemo<PubOption[]>(() => {
    const sessions = [tallyCurrent, ...tallyHistory].filter(
      (s): s is NonNullable<typeof s> => s != null,
    );
    const seen = new Set<string>();
    const out: PubOption[] = [];
    for (const session of sessions) {
      if (seen.has(session.pubKey)) continue;
      seen.add(session.pubKey);
      const { lat, lng } = decodeGeohash8(session.pubKey);
      out.push({
        key: session.pubKey,
        pub: { id: `tally:${session.pubKey}`, name: session.pubName, lat, lng },
        distanceMeters: null,
      });
      if (out.length >= RECENT_LIMIT) break;
    }
    return out;
  }, [tallyCurrent, tallyHistory]);

  const options = placeTab === 0 ? nearbyOptions : recentOptions;
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const selectedRecipientIdsValid = useMemo(
    () => selectedRecipientIds.filter((id) => friendIds.has(id)),
    [friendIds, selectedRecipientIds],
  );
  const selectedCount = audienceMode === 'all' ? friends.length : selectedRecipientIdsValid.length;
  const targetRecipientIds = audienceMode === 'custom' ? selectedRecipientIdsValid : undefined;

  useEffect(() => {
    pruneMemberIds(friends.map((friend) => friend.id));
  }, [friends, pruneMemberIds]);

  // Effective selection: an explicit pick, else the first option in the current
  // tab (so the CTA lights up without a tap, and the default follows the tab).
  const selectionKey = selectedKey ?? options[0]?.key ?? null;
  const selectionPub = selectedPub ?? options[0]?.pub ?? null;

  const selectPub = useCallback((option: PubOption) => {
    setSelectedKey(option.key);
    setSelectedPub(option.pub);
  }, []);

  const selectAllRecipients = useCallback(() => {
    setAudienceMode('all');
    setActiveGroupId(null);
    setSelectedRecipientIds([]);
  }, []);

  const selectGroup = useCallback((groupId: string) => {
    const group = usePartyGroupsStore.getState().groups.find((item) => item.id === groupId);
    if (!group) return;
    setAudienceMode('custom');
    setActiveGroupId(group.id);
    setSelectedRecipientIds(group.memberIds.filter((id) => friendIds.has(id)));
    setGroupName(group.name);
  }, [friendIds]);

  const startCustomSelection = useCallback(() => {
    setAudienceMode('custom');
    setActiveGroupId(null);
    if (selectedRecipientIds.length === 0) {
      setSelectedRecipientIds(friends.slice(0, 3).map((friend) => friend.id));
    }
  }, [friends, selectedRecipientIds.length]);

  const toggleRecipient = useCallback((id: string) => {
    setAudienceMode('custom');
    setActiveGroupId(null);
    setSelectedRecipientIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, []);

  const saveCurrentGroup = useCallback(() => {
    const savedId = upsertGroup(groupName, selectedRecipientIdsValid, activeGroupId ?? undefined);
    if (!savedId) {
      showToast(cs.friends.recipientGroupSaveHint);
      return;
    }
    setActiveGroupId(savedId);
    showToast(cs.friends.recipientGroupSaved);
  }, [activeGroupId, groupName, selectedRecipientIdsValid, showToast, upsertGroup]);

  const setHourClamped = useCallback(
    (h: number) => {
      // The wrap stepper can land below now; clamp to a future hour today.
      const clamped = Math.min(23, Math.max(Math.min(minHour, 23), h));
      setHour(clamped);
    },
    [minHour],
  );

  // ── Slide-up + owned slide-out. Shared value written ONLY in the effect. ──
  const [closing, setClosing] = useState(false);
  const progress = useSharedValue(0);
  useEffect(() => {
    if (closing) {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : 140 });
    } else {
      progress.value = reduceMotion ? withTiming(1, { duration: 0 }) : withSpring(1, SLIDE_SPRING);
    }
  }, [closing, reduceMotion, progress]);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, reduceMotion ? 0 : 150);
  }, [closing, onClose, reduceMotion]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  const isPlan = timeTab === 1;
  // A plan needs a strictly-future hour today (minutes clamped to :00). Kept pure
  // (no render-time clock call) — the actual ISO is built in the submit handler.
  const isValidPlanTime = hour > nowHour;
  const hasRecipients = audienceMode === 'all' || selectedRecipientIdsValid.length > 0;
  const canSubmit = !!selectionPub && (!isPlan || isValidPlanTime) && hasRecipients && !submitting;

  const handleSubmit = useCallback(() => {
    if (!selectionPub || submitting) return;
    if (isPlan && !isValidPlanTime) return;
    setSubmitting(true);

    const clientId = generateUuidV4();
    const trimmed = message.trim();
    let scheduledForISO: string | null = null;
    if (isPlan) {
      const d = new Date();
      d.setHours(hour, 0, 0, 0);
      scheduledForISO = d.toISOString();
    }
    const call: Promise<FriendActionResult> = isPlan
      ? createFriendPlan(selectionPub, scheduledForISO as string, trimmed, clientId, targetRecipientIds)
      : shareFriendPubActivity(selectionPub, trimmed, clientId, targetRecipientIds);

    void call.then((res) => {
      if (!mountedRef.current) return;
      if (res.ok) {
        showToast(isPlan ? cs.friends.planCreated : cs.friends.shareSuccess);
        onSubmitted();
        requestClose();
        return;
      }
      if (isRetriableFriendError(res)) {
        // Offline: queue the op (it WILL send) and close honestly.
        void enqueueFriendOp({
          op: 'activity',
          clientId,
          payload: { pub: selectionPub, message: trimmed, scheduledFor: scheduledForISO, recipientIds: targetRecipientIds },
        });
        showToast(isPlan ? cs.friends.planCreated : cs.friends.composeQueued);
        onSubmitted();
        requestClose();
        return;
      }
      // Hard reject: keep the sheet open with its data.
      setSubmitting(false);
      showToast(res.detail || cs.friends.shareError);
    });
  }, [
    selectionPub,
    submitting,
    isPlan,
    isValidPlanTime,
    hour,
    message,
    showToast,
    onSubmitted,
    requestClose,
    targetRecipientIds,
  ]);

  const showNearbyPermPrompt = placeTab === 0 && permissionState !== 'granted';
  const showNearbyLoading = placeTab === 0 && permissionState === 'granted' && loading;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={requestClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.settingsClose}
        />

        <Animated.View
          style={[styles.card, softDrop(), { paddingBottom: Math.max(insets.bottom, Spacing.md) }, cardAnim]}
        >
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.composeTitle}
            </Text>
          </View>

          <Pressable
            onPress={requestClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.dim]}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.settingsClose}
          >
            <XIcon size={18} color={Colors.foamMuted} />
          </Pressable>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* KOMU */}
            <SectionHeader label={cs.friends.composeAudienceLabel} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recipientChips}
            >
              <RecipientChip
                label={cs.friends.recipientAll}
                selected={audienceMode === 'all'}
                onPress={selectAllRecipients}
                icon={<UsersIcon size={16} color={audienceMode === 'all' ? Colors.stout : Colors.amber} />}
              />
              {groups.map((group) => (
                <RecipientChip
                  key={group.id}
                  label={group.name}
                  selected={audienceMode === 'custom' && activeGroupId === group.id}
                  onPress={() => selectGroup(group.id)}
                />
              ))}
              <RecipientChip
                label={cs.friends.recipientCustom}
                selected={audienceMode === 'custom' && activeGroupId == null}
                onPress={startCustomSelection}
                icon={<PlusIcon size={16} color={audienceMode === 'custom' && activeGroupId == null ? Colors.stout : Colors.amber} />}
              />
            </ScrollView>
            <Text style={styles.recipientSummary} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
              {audienceMode === 'all'
                ? cs.friends.recipientAllSummary(selectedCount)
                : cs.friends.recipientCustomSummary(selectedCount)}
            </Text>
            {audienceMode === 'custom' ? (
              <View style={styles.recipientPanel}>
                {friends.length === 0 ? (
                  <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.friends.recipientNoFriends}
                  </Text>
                ) : (
                  friends.map((friend) => (
                    <FriendRecipientRow
                      key={friend.id}
                      friend={friend}
                      selected={selectedRecipientIdsValid.includes(friend.id)}
                      onToggle={() => toggleRecipient(friend.id)}
                    />
                  ))
                )}
                <View style={styles.groupSaveRow}>
                  <TextInput
                    value={groupName}
                    onChangeText={setGroupName}
                    placeholder={cs.friends.recipientGroupPlaceholder}
                    placeholderTextColor={Colors.mutedText}
                    style={styles.groupNameInput}
                    maxLength={28}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  />
                  <Pressable
                    onPress={saveCurrentGroup}
                    disabled={selectedRecipientIdsValid.length === 0}
                    style={({ pressed }) => [
                      styles.groupSaveButton,
                      selectedRecipientIdsValid.length === 0 && styles.groupSaveButtonDisabled,
                      pressed && selectedRecipientIdsValid.length > 0 && styles.dim,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: selectedRecipientIdsValid.length === 0 }}
                    accessibilityLabel={cs.friends.recipientGroupSave}
                  >
                    <Text style={styles.groupSaveText} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.friends.recipientGroupSave}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* KDE */}
            <View style={styles.sectionGap}>
              <SectionHeader label={cs.friends.composePubLabel} />
            </View>
            <SegmentedControl
              options={[cs.friends.composeNearby, cs.friends.composeRecent]}
              value={placeTab}
              onChange={setPlaceTab}
            />
            <View style={styles.list}>
              {placeTab === 0 && showNearbyPermPrompt ? (
                <Pressable
                  onPress={() => void requestPermission()}
                  style={({ pressed }) => [styles.permRow, pressed && styles.dim]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.friends.composeLocPermCta}
                >
                  <MapPinIcon size={18} color={Colors.amber} />
                  <Text style={styles.permText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.friends.composeLocPermCta}
                  </Text>
                </Pressable>
              ) : showNearbyLoading ? (
                <View style={styles.skeletonList}>
                  {[0, 1, 2].map((i) => (
                    <SkeletonBlock key={i} width="100%" height={44} radius={Radius.medium} reduceMotion={reduceMotion} />
                  ))}
                </View>
              ) : options.length === 0 ? (
                <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {placeTab === 0 ? cs.friends.composeNoNearby : cs.friends.composeNoRecent}
                </Text>
              ) : (
                options.map((option) => (
                  <PubRow
                    key={option.key}
                    option={option}
                    selected={selectionKey === option.key}
                    onSelect={() => selectPub(option)}
                  />
                ))
              )}
            </View>

            {/* KDY */}
            <View style={styles.sectionGap}>
              <SectionHeader label={cs.friends.composeTimeLabel} />
              <SegmentedControl
                options={[cs.friends.composeNow, cs.friends.composeLater]}
                value={timeTab}
                onChange={setTimeTab}
              />
              {isPlan ? (
                <View style={styles.timePicker}>
                  {availablePresets.length > 0 ? (
                    <View style={styles.presetRow}>
                      {availablePresets.map((h) => {
                        const active = hour === h;
                        return (
                          <Pressable
                            key={h}
                            onPress={() => setHourClamped(h)}
                            style={({ pressed }) => [
                              styles.presetChip,
                              active && styles.presetChipActive,
                              pressed && styles.dim,
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`${h}:00`}
                          >
                            <Text
                              style={[styles.presetText, active && styles.presetTextActive]}
                              allowFontScaling={false}
                            >
                              {`${h}:00`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  <View style={styles.stepperLine}>
                    <HourStepper value={hour} onChange={setHourClamped} accessibilityLabel={cs.friends.composeTimeLabel} />
                  </View>
                </View>
              ) : null}
            </View>

            {/* VZKAZ */}
            <View style={styles.sectionGap}>
              <SectionHeader label={cs.friends.composeMsgLabel} />
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={cs.friends.composeMsgPlaceholder}
                placeholderTextColor={Colors.mutedText}
                style={styles.messageInput}
                multiline
                maxLength={MESSAGE_MAX}
                maxFontSizeMultiplier={FontScaleCap.body}
              />
            </View>
          </ScrollView>

          {/* Sticky CTA */}
          <View style={styles.footer}>
            {!canSubmit && !submitting ? (
              <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
                {!hasRecipients ? cs.friends.recipientNoSelection : cs.friends.composeNoPub}
              </Text>
            ) : null}
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.submit,
                !canSubmit && styles.submitDisabled,
                pressed && canSubmit && styles.submitPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
              accessibilityLabel={isPlan ? cs.friends.composeSubmitPlan : cs.friends.composeSubmitNow}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.stout} size="small" />
              ) : (
                <Text style={styles.submitLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {isPlan ? cs.friends.composeSubmitPlan : cs.friends.composeSubmitNow}
                </Text>
              )}
            </Pressable>
          </View>
        </Animated.View>

        <Toast />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  card: {
    maxHeight: '90%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: HitArea.min,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: {
    opacity: 0.6,
  },
  body: {
    flexShrink: 1,
    marginTop: Spacing.md,
  },
  sectionGap: {
    marginTop: Spacing.xl,
  },
  recipientChips: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  recipientChip: {
    minHeight: 40,
    maxWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.7),
    backgroundColor: withAlpha(Colors.foam, 0.05),
  },
  recipientChipActive: {
    borderColor: withAlpha(Colors.amber, 0.42),
    backgroundColor: Colors.amber,
  },
  recipientChipText: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  recipientChipTextActive: {
    color: Colors.stout,
  },
  recipientSummary: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  recipientPanel: {
    marginTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.45),
  },
  recipientRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.border, 0.36),
  },
  recipientRowSelected: {
    backgroundColor: withAlpha(Colors.amber, 0.06),
  },
  recipientCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.8),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.04),
  },
  recipientCheckActive: {
    borderColor: Colors.amber,
    backgroundColor: Colors.amber,
  },
  recipientNameWrap: {
    flex: 1,
    minWidth: 0,
  },
  recipientName: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  recipientSub: {
    marginTop: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  groupSaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  groupNameInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: Fonts.ui.semibold,
    color: Colors.foam,
    fontSize: 15,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  groupSaveButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSaveButtonDisabled: {
    opacity: 0.5,
  },
  groupSaveText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.amber,
  },
  list: {
    marginTop: Spacing.sm,
  },
  skeletonList: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  emptyText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.mutedText,
    paddingVertical: Spacing.md,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
    paddingVertical: Spacing.sm,
  },
  permText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
  },
  pubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.medium,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.border, 0.4),
  },
  pubRowSelected: {
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  pubRowText: {
    flex: 1,
    minWidth: 0,
  },
  pubName: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  pubCity: {
    marginTop: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  pubDistance: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  timePicker: {
    marginTop: Spacing.md,
    gap: Spacing.md,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  presetChip: {
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    backgroundColor: withAlpha(Colors.foam, 0.06),
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetChipActive: {
    borderColor: withAlpha(Colors.amber, 0.32),
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  presetText: {
    fontFamily: Fonts.display.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
  presetTextActive: {
    color: Colors.amber,
  },
  stepperLine: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  messageInput: {
    marginTop: Spacing.sm,
    minHeight: 54,
    fontFamily: Fonts.ui.semibold,
    color: Colors.foam,
    fontSize: 16,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    textAlignVertical: 'top',
  },
  footer: {
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  hint: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  submit: {
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    ...softDrop(),
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  submitLabel: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    letterSpacing: 0.3,
    color: Colors.stout,
  },
});

export default ComposeSheet;
