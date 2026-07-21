import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { generateUuidV4 } from '@/data/account';
import {
  createPartyEvening,
  endPartyEvening,
  fetchCurrentPartyEvening,
  joinPartyEvening,
  leavePartyEvening,
  sharePartyEveningDrink,
  type FriendActionError,
  type FriendProfile,
  type PartyEvening,
} from '@/data/friendsClient';
import {
  enqueueFriendOp,
  isRetriableFriendError,
} from '@/data/friendsQueue';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import {
  BeerIcon,
  ChevronLeftIcon,
  CopyIcon,
  MapPinIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function makeJoinCode(): string {
  const hex = generateUuidV4().replace(/-/g, '');
  return Array.from({ length: 6 }, (_, index) => {
    const value = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    return CODE_ALPHABET[(Number.isFinite(value) ? value : index) % CODE_ALPHABET.length];
  }).join('');
}

function profileName(profile: FriendProfile): string {
  return profile.nickname ? `@${profile.nickname}` : profile.displayName || 'Kamarád';
}

function timeLabel(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

function errorCopy(error: FriendActionError): string {
  if (error.code === 'ghost_mode') return cs.partyEvening.ghost;
  if (error.code === 'not_friends') return cs.partyEvening.notFriends;
  if (error.code === 'party_not_found' || error.code === 'party_not_active') {
    return cs.partyEvening.notFound;
  }
  return error.detail || cs.partyEvening.error;
}

function ActionButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.action,
        secondary && styles.actionSecondary,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      {icon}
      <Text style={[styles.actionLabel, secondary && styles.actionLabelSecondary]}>{label}</Text>
    </Pressable>
  );
}

export default function PartyEveningScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);
  const routeCode = useMemo(() => param(params.code).toUpperCase().slice(0, 6), [params.code]);

  const [evening, setEvening] = useState<PartyEvening | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pubName, setPubName] = useState('');
  const [pubCity, setPubCity] = useState('');
  const [joinCode, setJoinCode] = useState(routeCode);
  const [beerName, setBeerName] = useState('');
  const [pendingCreate, setPendingCreate] = useState<{
    code: string;
    pubName: string;
    pubCity: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    const result = await fetchCurrentPartyEvening();
    if (result.ok) {
      setEvening(result.evening);
      if (result.evening) setPendingCreate(null);
    } else {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const handleCreate = useCallback(async () => {
    const trimmedName = pubName.trim();
    if (!trimmedName || busy) return;
    setBusy(true);
    const clientId = generateUuidV4();
    const code = makeJoinCode();
    const startedAt = new Date().toISOString();
    const result = await createPartyEvening({
      clientId,
      joinCode: code,
      pubName: trimmedName,
      pubCity: pubCity.trim(),
      startedAt,
    });
    if (result.ok) {
      setEvening(result.evening);
    } else if (isRetriableFriendError(result)) {
      setPendingCreate({ code, pubName: trimmedName, pubCity: pubCity.trim() });
      await enqueueFriendOp({
        op: 'party-create',
        clientId,
        code,
        pubName: trimmedName,
        pubCity: pubCity.trim(),
        startedAt,
      });
      showToast(cs.partyEvening.actionQueued);
    } else {
      showToast(errorCopy(result));
    }
    setBusy(false);
  }, [busy, pubCity, pubName, showToast]);

  const handleJoin = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    const result = await joinPartyEvening(code);
    if (result.ok) {
      setEvening(result.evening);
    } else if (isRetriableFriendError(result)) {
      await enqueueFriendOp({ op: 'party-join', code });
      showToast(cs.partyEvening.actionQueued);
    } else {
      showToast(errorCopy(result));
    }
    setBusy(false);
  }, [busy, joinCode, showToast]);

  const handleShareDrink = useCallback(async () => {
    const trimmedBeer = beerName.trim();
    const code = evening?.joinCode ?? pendingCreate?.code;
    if (!code || !trimmedBeer || busy) return;
    setBusy(true);
    const clientId = generateUuidV4();
    const sharedAt = new Date().toISOString();
    const result = await sharePartyEveningDrink(code, {
      clientId,
      beerName: trimmedBeer,
      sharedAt,
    });
    if (result.ok) {
      setBeerName('');
      showToast(cs.partyEvening.shared);
      await load();
    } else if (isRetriableFriendError(result)) {
      await enqueueFriendOp({
        op: 'party-drink',
        code,
        clientId,
        beerName: trimmedBeer,
        quantity: 1,
        sharedAt,
      });
      setBeerName('');
      showToast(cs.partyEvening.actionQueued);
    } else {
      showToast(errorCopy(result));
    }
    setBusy(false);
  }, [beerName, busy, evening, load, pendingCreate?.code, showToast]);

  const handleLeaveOrEnd = useCallback(async () => {
    if (!evening || busy) return;
    setBusy(true);
    const result = evening.isHost
      ? await endPartyEvening(evening.joinCode)
      : await leavePartyEvening(evening.joinCode);
    if (result.ok) {
      showToast(evening.isHost ? cs.partyEvening.ended : cs.partyEvening.left);
    } else if (isRetriableFriendError(result)) {
      await enqueueFriendOp({
        op: evening.isHost ? 'party-end' : 'party-leave',
        code: evening.joinCode,
      });
      showToast(cs.partyEvening.actionQueued);
    } else {
      showToast(errorCopy(result));
      setBusy(false);
      return;
    }
    setEvening(null);
    setBusy(false);
    router.back();
  }, [busy, evening, router, showToast]);

  const copyCode = useCallback(async (code: string) => {
    await Clipboard.setStringAsync(code);
    showToast(cs.partyEvening.copied);
  }, [showToast]);

  const activeCode = evening?.joinCode ?? pendingCreate?.code ?? '';
  const activePubName = evening?.pubName ?? pendingCreate?.pubName ?? '';
  const activePubCity = evening?.pubCity ?? pendingCreate?.pubCity ?? '';

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior="padding"
        enabled={Platform.OS === 'android'}
      >
        <KeyboardAwareScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.backButton}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <ChevronLeftIcon size={24} color={Colors.foam} />
            </Pressable>
            <View style={styles.headerText}>
              <Text style={styles.kicker}>{cs.partyEvening.kicker}</Text>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.partyEvening.title}
              </Text>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={Colors.amber} style={styles.loader} />
          ) : evening || pendingCreate ? (
            <>
              <View style={styles.heroPanel}>
                <Text style={styles.sectionLabel}>{cs.partyEvening.activeKicker}</Text>
                <Text style={styles.pubTitle}>{activePubName}</Text>
                {activePubCity ? (
                  <View style={styles.inlineMeta}>
                    <MapPinIcon size={15} color={Colors.mutedText} />
                    <Text style={styles.metaText}>{activePubCity}</Text>
                  </View>
                ) : null}
                {evening ? (
                  <>
                    <Text style={styles.hostText}>
                      {cs.partyEvening.hostedBy(profileName(evening.host))}
                    </Text>
                    <View style={styles.inlineMeta}>
                      <UsersIcon size={16} color={Colors.amber} />
                      <Text style={styles.memberText}>
                        {cs.partyEvening.memberCount(evening.members.length)}
                      </Text>
                    </View>
                  </>
                ) : (
                  <Text style={styles.pendingText}>{cs.partyEvening.pending}</Text>
                )}
              </View>

              <View style={styles.codeRow}>
                <View>
                  <Text style={styles.inputLabel}>{cs.partyEvening.codeLabel}</Text>
                  <Text style={styles.code}>{activeCode}</Text>
                </View>
                <Pressable
                  onPress={() => void copyCode(activeCode)}
                  accessibilityRole="button"
                  accessibilityLabel={cs.partyEvening.copyCode}
                  style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
                >
                  <CopyIcon size={18} color={Colors.amber} />
                </Pressable>
              </View>

              {evening?.active ? (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{cs.partyEvening.feed}</Text>
                    {evening.events.length > 0 ? (
                      evening.events.map((event) => {
                        const name = profileName(event.account);
                        return (
                          <View key={event.id} style={styles.eventRow}>
                            <View style={styles.eventIcon}>
                              {event.kind === 'drink' ? (
                                <BeerIcon size={16} color={Colors.amber} />
                              ) : (
                                <UsersIcon size={16} color={Colors.amber} />
                              )}
                            </View>
                            <Text style={styles.eventText}>
                              {event.kind === 'drink'
                                ? cs.partyEvening.drank(name, event.beerName, event.quantity)
                                : cs.partyEvening.joined(name)}
                            </Text>
                            <Text style={styles.eventTime}>{timeLabel(event.at)}</Text>
                          </View>
                        );
                      })
                    ) : (
                      <Text style={styles.emptyText}>{cs.partyEvening.emptyFeed}</Text>
                    )}
                  </View>

                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{cs.partyEvening.drinkLabel}</Text>
                    <TextInput
                      value={beerName}
                      onChangeText={setBeerName}
                      placeholder={cs.partyEvening.drinkPlaceholder}
                      placeholderTextColor={Colors.mutedText}
                      style={styles.input}
                      maxLength={120}
                      returnKeyType="send"
                      onSubmitEditing={() => void handleShareDrink()}
                    />
                    <Text style={styles.privacyText}>{cs.partyEvening.drinkPrivacy}</Text>
                    <ActionButton
                      label={cs.partyEvening.shareDrink}
                      onPress={() => void handleShareDrink()}
                      disabled={!beerName.trim() || busy}
                      icon={<BeerIcon size={18} color={Colors.stout} />}
                    />
                  </View>

                  <ActionButton
                    label={evening.isHost ? cs.partyEvening.end : cs.partyEvening.leave}
                    onPress={() => void handleLeaveOrEnd()}
                    disabled={busy}
                    secondary
                  />
                </>
              ) : pendingCreate ? (
                <>
                  <View style={styles.section}>
                    <Text style={styles.sectionLabel}>{cs.partyEvening.drinkLabel}</Text>
                    <TextInput
                      value={beerName}
                      onChangeText={setBeerName}
                      placeholder={cs.partyEvening.drinkPlaceholder}
                      placeholderTextColor={Colors.mutedText}
                      style={styles.input}
                      maxLength={120}
                      returnKeyType="send"
                      onSubmitEditing={() => void handleShareDrink()}
                    />
                    <Text style={styles.privacyText}>{cs.partyEvening.drinkPrivacy}</Text>
                    <ActionButton
                      label={cs.partyEvening.shareDrink}
                      onPress={() => void handleShareDrink()}
                      disabled={!beerName.trim() || busy}
                      icon={<BeerIcon size={18} color={Colors.stout} />}
                    />
                  </View>
                  <ActionButton label={cs.partyEvening.reload} onPress={() => void load()} secondary />
                </>
              ) : (
                <Text style={styles.emptyText}>{cs.partyEvening.ended}</Text>
              )}
            </>
          ) : (
            <>
              <Text style={styles.intro}>{cs.partyEvening.intro}</Text>
              <Text style={styles.privacyText}>{cs.partyEvening.privacy}</Text>
              {loadError ? (
                <Pressable onPress={() => void load()} style={styles.errorStrip}>
                  <Text style={styles.errorText}>{cs.partyEvening.error}</Text>
                </Pressable>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{cs.partyEvening.create}</Text>
                <Text style={styles.inputLabel}>{cs.partyEvening.pubName}</Text>
                <TextInput
                  value={pubName}
                  onChangeText={setPubName}
                  placeholder={cs.partyEvening.pubNamePlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={styles.input}
                  maxLength={200}
                />
                <Text style={styles.inputLabel}>{cs.partyEvening.pubCity}</Text>
                <TextInput
                  value={pubCity}
                  onChangeText={setPubCity}
                  placeholder={cs.partyEvening.pubCityPlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={styles.input}
                  maxLength={120}
                  onSubmitEditing={() => void handleCreate()}
                />
                <ActionButton
                  label={cs.partyEvening.create}
                  onPress={() => void handleCreate()}
                  disabled={!pubName.trim() || busy}
                  icon={<UsersIcon size={18} color={Colors.stout} />}
                />
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>NEBO</Text>
                <View style={styles.divider} />
              </View>

              <View style={styles.joinSection}>
                <Text style={styles.sectionLabel}>{cs.partyEvening.joinLabel}</Text>
                <TextInput
                  value={joinCode}
                  onChangeText={(value) => setJoinCode(value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6))}
                  placeholder={cs.partyEvening.joinPlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={[styles.input, styles.codeInput]}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  returnKeyType="go"
                  onSubmitEditing={() => void handleJoin()}
                />
                <ActionButton
                  label={cs.partyEvening.join}
                  onPress={() => void handleJoin()}
                  disabled={joinCode.length !== 6 || busy}
                  secondary
                />
              </View>
            </>
          )}
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  backButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -Spacing.sm,
  },
  headerText: { flex: 1 },
  kicker: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 10,
    letterSpacing: 1.4,
    color: Colors.amber,
  },
  title: {
    marginTop: 2,
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    lineHeight: 34,
    color: Colors.foam,
  },
  loader: { marginTop: Spacing.xxl },
  intro: {
    fontFamily: Fonts.display.bold,
    fontSize: 21,
    lineHeight: 27,
    color: Colors.foam,
  },
  privacyText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
  },
  heroPanel: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
  },
  section: { gap: Spacing.sm },
  joinSection: { gap: Spacing.sm, paddingBottom: Spacing.lg },
  sectionLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 1.35,
    color: Colors.amber,
  },
  pubTitle: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    lineHeight: 33,
    color: Colors.foam,
  },
  hostText: {
    marginTop: Spacing.md,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.foamMuted,
  },
  inlineMeta: { marginTop: Spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontFamily: Fonts.ui.regular, fontSize: 14, color: Colors.mutedText },
  memberText: { fontFamily: Fonts.ui.medium, fontSize: 14, color: Colors.foamMuted },
  pendingText: {
    marginTop: Spacing.md,
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.amberLight,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  code: {
    marginTop: 4,
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    letterSpacing: 5,
    color: Colors.foam,
  },
  copyButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputLabel: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout2,
    paddingHorizontal: Spacing.md,
    fontFamily: Fonts.ui.medium,
    fontSize: 16,
    color: Colors.foam,
  },
  codeInput: { fontFamily: Fonts.display.bold, letterSpacing: 4, textAlign: 'center' },
  action: {
    minHeight: 50,
    marginTop: Spacing.sm,
    borderRadius: Radius.medium,
    backgroundColor: Colors.amber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  actionSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionLabel: { fontFamily: Fonts.ui.bold, fontSize: 15, color: Colors.stout },
  actionLabelSecondary: { color: Colors.foam },
  pressed: { opacity: 0.55 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: Colors.mutedText,
  },
  eventRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(Colors.border, 0.7),
  },
  eventIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  eventText: { flex: 1, fontFamily: Fonts.ui.medium, fontSize: 14, color: Colors.foamMuted },
  eventTime: { fontFamily: Fonts.ui.regular, fontSize: 12, color: Colors.mutedText },
  emptyText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
  },
  errorStrip: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.amber,
    paddingVertical: Spacing.sm,
    paddingLeft: Spacing.md,
  },
  errorText: { fontFamily: Fonts.ui.medium, fontSize: 14, color: Colors.amberLight },
});
