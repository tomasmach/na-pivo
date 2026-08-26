/**
 * BeerPhotoComposeSheet — caption + pub tag + visibility for a freshly picked
 * beer photo, ending in "Uložit do deníčku".
 *
 * Save is fully offline-first: the picked (cache) image is copied into the
 * durable diary directory, then handed to beerPhotosQueue. The sheet closes
 * only after that retry op is durably stored, but never waits on the network.
 *
 * The pub tag prefers what the app already knows: an active counter session
 * pins its pub as the suggestion, otherwise the nearby auto-detect (GPS only
 * while this sheet is up, via useNearbyPub) fills it in. Both are just
 * suggestions — one tap on the X clears the tag and it stays cleared.
 *
 * The shared sheet host owns keyboard lift and preserves this form while the
 * pub picker is presented, so two native sheets are never stacked on iOS.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { GlowButton } from '@/components/shared/GlowButton';
import {
  EyeOffIcon,
  InfoIcon,
  MapPinIcon,
  TrophyIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import type { BeerPhotoVisibility } from '@/data/beerPhotosClient';
import {
  deleteBeerPhotoLocalFile,
  enqueueBeerPhoto,
  persistBeerPhotoLocally,
  resolveBeerPhotoPartyAssociation,
} from '@/data/beerPhotosQueue';
import { generateUuidV4 } from '@/data/account';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { PubPickerModal } from '@/counter/PubPickerModal';
import { useNearbyPub } from '@/counter/useNearbyPub';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { selectConfirmedPartyJoinCode, usePartyEveningStore } from '@/stores/partyEveningStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useToastStore } from '@/stores/toastStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { fireSuccessHaptic } from '@/utils/haptics';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { isContextPubKey } from '@/drinks/drinkTypes';

const CAPTION_MAX = 280;
const SHEET_SWITCH_MS = 260;

/** The tag the diary stores: durable geohash-8 key + display name/city. */
interface PhotoPubTag {
  pubKey: string;
  name: string;
  city: string;
}

interface BeerPhotoComposeSheetProps {
  /** Downscaled JPEG from the picker (cache uri — persisted durably on save). */
  pickedUri: string;
  /** Preselect FotoPivař when the capture started from the contest screen. */
  initialContestEntry?: boolean;
  partyCode?: string | null;
  pendingPartyCode?: string | null;
  partyDrinkingDay?: string | null;
  onClose: () => void;
  /** Fired only after the photo is durably queued (sheet is now closable). */
  onSaved: (result: BeerPhotoSaveResult) => void;
}

export interface BeerPhotoSaveResult {
  clientId: string;
  contestRequested: boolean;
  /** Settles after the immediate upload attempt (the queue may still retry). */
  completion: Promise<void>;
}

/** An active counter session pins its pub as the initial tag suggestion. */
function tallyPubSuggestion(): PhotoPubTag | null {
  const current = useTallyStore.getState().current;
  if (!current || !current.pubName) return null;
  // An outside evening is no pub — the photo defaults to "Bez hospody".
  if (isContextPubKey(current.pubKey)) return null;
  return { pubKey: current.pubKey, name: current.pubName, city: '' };
}

export function BeerPhotoComposeSheet({
  pickedUri,
  initialContestEntry = false,
  partyCode,
  pendingPartyCode,
  partyDrinkingDay,
  onClose,
  onSaved,
}: BeerPhotoComposeSheetProps) {
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);

  const [caption, setCaption] = useState('');
  const [manualPub, setManualPub] = useState<PhotoPubTag | null>(null);
  // Once the user clears the tag, no auto-suggestion may sneak back in.
  const [pubCleared, setPubCleared] = useState(false);
  const [visibility, setVisibility] = useState<BeerPhotoVisibility>('friends');
  const [enterContest, setEnterContest] = useState(initialContestEntry);
  const [composeVisible, setComposeVisible] = useState(true);
  const [pickerVisible, setPickerVisible] = useState(false);
  const sheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  // Reuse the id if a storage write fails ambiguously and the user retries.
  // AsyncStorage can reject after starting a native write; a stable id keeps
  // that edge case idempotent instead of creating a second photo.
  const clientIdRef = useRef<string | null>(null);

  const nearby = useNearbyPub();

  useEffect(
    () => () => {
      if (sheetTimer.current) clearTimeout(sheetTimer.current);
    },
    [],
  );

  const runAfterSheetClose = useCallback((action: () => void) => {
    if (sheetTimer.current) clearTimeout(sheetTimer.current);
    sheetTimer.current = setTimeout(() => {
      sheetTimer.current = null;
      action();
    }, SHEET_SWITCH_MS);
  }, []);

  // The effective tag is DERIVED (no setState-in-effect): a manual pick wins,
  // then — unless explicitly cleared — the active counter session, then the
  // nearby auto-detect.
  const tallySuggestion = useMemo(() => tallyPubSuggestion(), []);
  const nearbySelected = nearby.selected;
  const nearbySuggestion = useMemo<PhotoPubTag | null>(
    () =>
      nearbySelected
        ? {
            pubKey: geohash8(nearbySelected.lat, nearbySelected.lng),
            name: nearbySelected.name,
            city: nearbySelected.city ?? '',
          }
        : null,
    [nearbySelected],
  );
  const pub = manualPub ?? (pubCleared ? null : (tallySuggestion ?? nearbySuggestion));

  const openPubPicker = useCallback(() => {
    if (nearby.candidates.length > 0) {
      setComposeVisible(false);
      runAfterSheetClose(() => setPickerVisible(true));
      return;
    }
    if (nearby.permissionState !== 'granted') {
      void nearby.requestPermission();
      return;
    }
    showToast(t.photoDiary.pubNoneNearby, {
      icon: <MapPinIcon size={18} color={Colors.amber} />,
    });
  }, [nearby, runAfterSheetClose, showToast]);

  const closePubPicker = useCallback(() => {
    setPickerVisible(false);
    runAfterSheetClose(() => setComposeVisible(true));
  }, [runAfterSheetClose]);

  const handleSelectPub = useCallback(
    (selected: Pub) => {
      setManualPub({
        pubKey: geohash8(selected.lat, selected.lng),
        name: selected.name,
        city: selected.city ?? '',
      });
      closePubPicker();
    },
    [closePubPicker],
  );

  const clearPub = useCallback(() => {
    setManualPub(null);
    setPubCleared(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;

    const clientId = clientIdRef.current ?? generateUuidV4();
    clientIdRef.current = clientId;
    const durableUri = await persistBeerPhotoLocally(pickedUri, clientId);
    const reservedCode = pendingPartyCode?.toUpperCase() ?? null;
    const partyState = usePartyEveningStore.getState();
    const latestConfirmedCode = selectConfirmedPartyJoinCode(partyState);
    const confirmedCode =
      partyCode ??
      (reservedCode && latestConfirmedCode?.toUpperCase() === reservedCode
        ? latestConfirmedCode
        : null);
    const deferredCode =
      !confirmedCode && reservedCode && partyState.pendingJoinCode?.toUpperCase() === reservedCode
        ? reservedCode
        : null;
    const queued = await enqueueBeerPhoto({
      clientId,
      localUri: durableUri,
      caption: caption.trim(),
      pubCacheKey: pub?.pubKey,
      pubName: pub?.name,
      pubCity: pub?.city,
      partyCode: confirmedCode ?? undefined,
      pendingPartyCode: deferredCode ?? undefined,
      partyDrinkingDay: partyDrinkingDay ?? undefined,
      visibility,
      takenAt: new Date().toISOString(),
      enterContest,
    });
    if (!queued.persisted) {
      // Do not leave an orphaned copy behind. The original pickedUri remains
      // available in the open compose sheet for another attempt.
      deleteBeerPhotoLocalFile(clientId);
      savingRef.current = false;
      showToast(t.photoDiary.errorSave, {
        icon: <InfoIcon size={18} color={Colors.foamMuted} />,
      });
      return;
    }
    if (deferredCode) {
      // Close the tiny race where the table response settles between our state
      // read and the durable queue write. If it is still pending, the evening
      // store will resolve the association when its request completes.
      const latestPartyState = usePartyEveningStore.getState();
      const confirmedAfterWrite = selectConfirmedPartyJoinCode(latestPartyState);
      if (confirmedAfterWrite?.toUpperCase() === deferredCode) {
        void resolveBeerPhotoPartyAssociation(deferredCode, confirmedAfterWrite);
      } else if (latestPartyState.pendingJoinCode?.toUpperCase() !== deferredCode) {
        void resolveBeerPhotoPartyAssociation(deferredCode, null);
      }
    }
    if (useSettingsStore.getState().hapticEnabled) fireSuccessHaptic();
    onSaved({
      clientId,
      contestRequested: enterContest,
      completion: queued.completion,
    });
  }, [
    pickedUri,
    caption,
    pub,
    partyCode,
    pendingPartyCode,
    partyDrinkingDay,
    visibility,
    enterContest,
    onSaved,
    showToast,
  ]);

  return (
    <>
      <BottomSheetModal visible={composeVisible} onClose={onClose} keepMounted keyboardLift>
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.photoDiary.composeTitle}
              </Text>
              <CloseButton onPress={onClose} label={t.a11y.photoViewerClose} />
            </View>

            <KeyboardAwareScrollView
              style={styles.list}
              keyboardAvoidedExternally
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
            >
              {/* Preview */}
              <Image
                source={{ uri: pickedUri }}
                style={styles.preview}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />

              {/* Caption */}
              <Text style={styles.fieldLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.photoDiary.captionLabel}
              </Text>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder={t.photoDiary.captionPlaceholder}
                placeholderTextColor={MockColors.fieldHint}
                style={styles.captionInput}
                multiline
                maxLength={CAPTION_MAX}
                accessibilityLabel={t.a11y.photoCaptionInput}
                maxFontSizeMultiplier={FontScaleCap.body}
              />

              {/* Pub tag */}
              <Text style={styles.fieldLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.photoDiary.pubLabel}
              </Text>
              <View style={styles.pubRow}>
                <Pressable
                  onPress={openPubPicker}
                  style={({ pressed }) => [styles.pubRowMain, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={t.a11y.photoPickPub}
                >
                  <MapPinIcon size={17} color={pub ? Colors.amber : Colors.mutedText} />
                  <Text
                    style={[styles.pubName, !pub && styles.pubNameEmpty]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {pub ? [pub.name, pub.city].filter(Boolean).join(' · ') : t.photoDiary.pubNone}
                  </Text>
                </Pressable>
                {pub ? (
                  <Pressable
                    onPress={clearPub}
                    style={({ pressed }) => [styles.pubClear, pressed && styles.pressed]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t.a11y.photoClearPub}
                  >
                    <XIcon size={16} color={Colors.mutedText} />
                  </Pressable>
                ) : null}
              </View>

              {/* Visibility */}
              <Text style={styles.fieldLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.photoDiary.visibilityLabel}
              </Text>
              <View style={styles.segment}>
                <Pressable
                  onPress={() => setVisibility('private')}
                  style={[styles.segmentOption, visibility === 'private' && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: visibility === 'private' }}
                  accessibilityLabel={t.a11y.photoVisibility(t.photoDiary.visibilityPrivate)}
                >
                  <EyeOffIcon
                    size={15}
                    color={visibility === 'private' ? Colors.stout : Colors.mutedText}
                  />
                  <Text
                    style={[
                      styles.segmentText,
                      visibility === 'private' && styles.segmentTextActive,
                    ]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {t.photoDiary.visibilityPrivate}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setVisibility('friends')}
                  style={[styles.segmentOption, visibility === 'friends' && styles.segmentActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: visibility === 'friends' }}
                  accessibilityLabel={t.a11y.photoVisibility(t.photoDiary.visibilityFriends)}
                >
                  <UsersIcon
                    size={15}
                    color={visibility === 'friends' ? Colors.stout : Colors.mutedText}
                  />
                  <Text
                    style={[
                      styles.segmentText,
                      visibility === 'friends' && styles.segmentTextActive,
                    ]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {t.photoDiary.visibilityFriends}
                  </Text>
                </Pressable>
              </View>

              {/* FotoPivař is an explicit public opt-in, independent of the diary
                visibility above. The full row is tappable for pub-table use. */}
              <Pressable
                onPress={() => setEnterContest((value) => !value)}
                style={({ pressed }) => [
                  styles.contestToggle,
                  enterContest && styles.contestToggleActive,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="switch"
                accessibilityState={{ checked: enterContest }}
                accessibilityLabel={t.a11y.photoContestToggle}
              >
                <View
                  style={[styles.contestIconWell, enterContest && styles.contestIconWellActive]}
                >
                  <TrophyIcon size={19} color={enterContest ? Colors.stout : Colors.amber} />
                </View>
                <View style={styles.contestToggleCopy}>
                  <Text
                    style={styles.contestToggleTitle}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {t.photoDiary.addToContest}
                  </Text>
                  <Text style={styles.contestToggleHint} maxFontSizeMultiplier={FontScaleCap.body}>
                    {t.photoDiary.addToContestHint}
                  </Text>
                </View>
                <View style={[styles.toggleTrack, enterContest && styles.toggleTrackActive]}>
                  <View style={[styles.toggleThumb, enterContest && styles.toggleThumbActive]} />
                </View>
              </Pressable>
            </KeyboardAwareScrollView>

            <View style={styles.saveWrap}>
              <GlowButton
                label={enterContest ? t.photoDiary.saveAndEnterContest : t.photoDiary.save}
                onPress={() => void handleSave()}
                glow="none"
                height={56}
              />
            </View>
          </View>
        </View>
      </BottomSheetModal>

      <PubPickerModal
        visible={pickerVisible}
        candidates={nearby.candidates}
        selectedKey={pub?.pubKey ?? null}
        onSelect={handleSelectPub}
        onClose={closePubPicker}
      />
    </>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: MockLayout.controlGap,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  list: { flexGrow: 0, flexShrink: 1 },
  content: {
    paddingBottom: Spacing.sm,
  },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  fieldLabel: {
    ...MockType.bodySmall,
    fontWeight: '600',
    color: Colors.foamMuted,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    marginLeft: 4,
  },
  captionInput: {
    minHeight: 72,
    maxHeight: 132,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm + 2,
    paddingBottom: Spacing.sm + 2,
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foam,
    textAlignVertical: 'top',
  },
  pubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pubRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  pubName: {
    flex: 1,
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foam,
  },
  pubNameEmpty: {
    fontWeight: '400',
    color: Colors.mutedText,
  },
  pubClear: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  segmentOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: HitArea.min,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  segmentActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  segmentText: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.mutedText,
  },
  segmentTextActive: {
    color: Colors.stout,
  },
  contestToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 76,
    marginTop: Spacing.lg,
    padding: Spacing.sm + 2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  contestToggleActive: {
    borderColor: withAlpha(Colors.amber, 0.58),
    backgroundColor: withAlpha(Colors.amber, 0.09),
  },
  contestIconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.13),
  },
  contestIconWellActive: {
    backgroundColor: Colors.amber,
  },
  contestToggleCopy: {
    flex: 1,
    minWidth: 0,
  },
  contestToggleTitle: {
    fontWeight: '800',
    fontSize: 15,
    color: Colors.foam,
  },
  contestToggleHint: {
    marginTop: 2,
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 17,
    color: Colors.mutedText,
  },
  toggleTrack: {
    width: 46,
    height: 28,
    borderRadius: Radius.pill,
    padding: 3,
    backgroundColor: Colors.stout,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleTrackActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foamMuted,
  },
  toggleThumbActive: {
    transform: [{ translateX: 18 }],
    backgroundColor: Colors.stout,
  },
  saveWrap: {
    marginTop: Spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
});
