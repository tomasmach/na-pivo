/**
 * BeerPhotoComposeSheet — caption + pub tag + visibility for a freshly picked
 * beer photo, ending in "Uložit do deníčku".
 *
 * Save is fully offline-first: the picked (cache) image is copied into the
 * durable diary directory, then handed to beerPhotosQueue which inserts the
 * optimistic store entry and retries the upload until it lands — so this sheet
 * closes instantly and never blocks on the network.
 *
 * The pub tag prefers what the app already knows: an active counter session
 * pins its pub as the suggestion, otherwise the nearby auto-detect (GPS only
 * while this sheet is up, via useNearbyPub) fills it in. Both are just
 * suggestions — one tap on the X clears the tag and it stays cleared.
 *
 * Modal-hosted, so the keyboard lift is manual (useKeyboardHeight) — KAV
 * measures the wrong window inside an RN Modal on iOS (ComposeSheet idiom).
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/shared/GlowButton';
import {
  EyeOffIcon,
  MapPinIcon,
  TrophyIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import type { BeerPhotoVisibility } from '@/data/beerPhotosClient';
import { enqueueBeerPhoto, persistBeerPhotoLocally } from '@/data/beerPhotosQueue';
import { generateUuidV4 } from '@/data/account';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { PubPickerModal } from '@/counter/PubPickerModal';
import { useNearbyPub } from '@/counter/useNearbyPub';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useToastStore } from '@/stores/toastStore';
import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { fireSuccessHaptic } from '@/utils/haptics';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { isContextPubKey } from '@/drinks/drinkTypes';

const CAPTION_MAX = 280;

/** The tag the diary stores: durable geohash-8 key + display name/city. */
export interface PhotoPubTag {
  pubKey: string;
  name: string;
  city: string;
}

interface BeerPhotoComposeSheetProps {
  /** Downscaled JPEG from the picker (cache uri — persisted durably on save). */
  pickedUri: string;
  /** Preselect FotoPivař when the capture started from the contest screen. */
  initialContestEntry?: boolean;
  /** Party/counter context wins over location guessing when supplied. */
  initialPub?: PhotoPubTag | null;
  onClose: () => void;
  /** Fired after the photo is queued (sheet already closable). */
  onSaved: (result: BeerPhotoSaveResult) => void;
}

export interface BeerPhotoSaveResult {
  clientId: string;
  contestRequested: boolean;
  /** Settles after the immediate upload attempt (the queue may still retry). */
  completion: Promise<void>;
}

/** An active counter session pins its pub as the initial tag suggestion. */
function tallyPubSuggestion(initialPub?: PhotoPubTag | null): PhotoPubTag | null {
  if (initialPub?.pubKey && initialPub.name) return initialPub;
  const current = useTallyStore.getState().current;
  if (!current || !current.pubName) return null;
  // An outside evening is no pub — the photo defaults to "Bez hospody".
  if (isContextPubKey(current.pubKey)) return null;
  return { pubKey: current.pubKey, name: current.pubName, city: '' };
}

export function BeerPhotoComposeSheet({
  pickedUri,
  initialContestEntry = false,
  initialPub,
  onClose,
  onSaved,
}: BeerPhotoComposeSheetProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const showToast = useToastStore((s) => s.show);

  const [caption, setCaption] = useState('');
  const [manualPub, setManualPub] = useState<PhotoPubTag | null>(null);
  // Once the user clears the tag, no auto-suggestion may sneak back in.
  const [pubCleared, setPubCleared] = useState(false);
  const [visibility, setVisibility] = useState<BeerPhotoVisibility>('friends');
  const [enterContest, setEnterContest] = useState(initialContestEntry);
  const [pickerVisible, setPickerVisible] = useState(false);
  const savingRef = useRef(false);

  const nearby = useNearbyPub();

  // The effective tag is DERIVED (no setState-in-effect): a manual pick wins,
  // then — unless explicitly cleared — the active counter session, then the
  // nearby auto-detect.
  const tallySuggestion = useMemo(() => tallyPubSuggestion(initialPub), [initialPub]);
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
  const pub = manualPub ?? (pubCleared ? null : tallySuggestion ?? nearbySuggestion);

  const openPubPicker = useCallback(() => {
    if (nearby.candidates.length > 0) {
      setPickerVisible(true);
      return;
    }
    if (nearby.permissionState !== 'granted') {
      void nearby.requestPermission();
      return;
    }
    showToast(cs.photoDiary.pubNoneNearby, {
      icon: <MapPinIcon size={18} color={Colors.amber} />,
    });
  }, [nearby, showToast]);

  const handleSelectPub = useCallback((selected: Pub) => {
    setManualPub({
      pubKey: geohash8(selected.lat, selected.lng),
      name: selected.name,
      city: selected.city ?? '',
    });
    setPickerVisible(false);
  }, []);

  const clearPub = useCallback(() => {
    setManualPub(null);
    setPubCleared(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;

    const clientId = generateUuidV4();
    const durableUri = await persistBeerPhotoLocally(pickedUri, clientId);
    // Fire-and-forget: enqueue inserts the optimistic store entry synchronously
    // and retries the upload in the background — never block the sheet on it.
    const completion = enqueueBeerPhoto({
      clientId,
      localUri: durableUri,
      caption: caption.trim(),
      pubCacheKey: pub?.pubKey,
      pubName: pub?.name,
      pubCity: pub?.city,
      visibility,
      takenAt: new Date().toISOString(),
      enterContest,
    });
    if (useSettingsStore.getState().hapticEnabled) fireSuccessHaptic();
    onSaved({ clientId, contestRequested: enterContest, completion });
  }, [pickedUri, caption, pub, visibility, enterContest, onSaved]);

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            {
              paddingBottom:
                keyboardHeight > 0 ? keyboardHeight + Spacing.md : Math.max(insets.bottom, Spacing.lg),
            },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.photoDiary.composeTitle}
            </Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.photoViewerClose}
            >
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <KeyboardAwareScrollView
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
              {cs.photoDiary.captionLabel}
            </Text>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={cs.photoDiary.captionPlaceholder}
              placeholderTextColor={MockColors.fieldHint}
              style={styles.captionInput}
              multiline
              maxLength={CAPTION_MAX}
              accessibilityLabel={cs.a11y.photoCaptionInput}
              maxFontSizeMultiplier={FontScaleCap.body}
            />

            {/* Pub tag */}
            <Text style={styles.fieldLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.photoDiary.pubLabel}
            </Text>
            <View style={styles.pubRow}>
              <Pressable
                onPress={openPubPicker}
                style={({ pressed }) => [styles.pubRowMain, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.photoPickPub}
              >
                <MapPinIcon size={17} color={pub ? Colors.amber : Colors.mutedText} />
                <Text
                  style={[styles.pubName, !pub && styles.pubNameEmpty]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {pub ? [pub.name, pub.city].filter(Boolean).join(' · ') : cs.photoDiary.pubNone}
                </Text>
              </Pressable>
              {pub ? (
                <Pressable
                  onPress={clearPub}
                  style={({ pressed }) => [styles.pubClear, pressed && styles.pressed]}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.photoClearPub}
                >
                  <XIcon size={16} color={Colors.mutedText} />
                </Pressable>
              ) : null}
            </View>

            {/* Visibility */}
            <Text style={styles.fieldLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.photoDiary.visibilityLabel}
            </Text>
            <View style={styles.segment}>
              <Pressable
                onPress={() => setVisibility('private')}
                style={[styles.segmentOption, visibility === 'private' && styles.segmentActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === 'private' }}
                accessibilityLabel={cs.a11y.photoVisibility(cs.photoDiary.visibilityPrivate)}
              >
                <EyeOffIcon
                  size={15}
                  color={visibility === 'private' ? Colors.stout : Colors.mutedText}
                />
                <Text
                  style={[styles.segmentText, visibility === 'private' && styles.segmentTextActive]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.photoDiary.visibilityPrivate}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility('friends')}
                style={[styles.segmentOption, visibility === 'friends' && styles.segmentActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === 'friends' }}
                accessibilityLabel={cs.a11y.photoVisibility(cs.photoDiary.visibilityFriends)}
              >
                <UsersIcon
                  size={15}
                  color={visibility === 'friends' ? Colors.stout : Colors.mutedText}
                />
                <Text
                  style={[styles.segmentText, visibility === 'friends' && styles.segmentTextActive]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.photoDiary.visibilityFriends}
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
              accessibilityLabel={cs.a11y.photoContestToggle}
            >
              <View style={[styles.contestIconWell, enterContest && styles.contestIconWellActive]}>
                <TrophyIcon size={19} color={enterContest ? Colors.stout : Colors.amber} />
              </View>
              <View style={styles.contestToggleCopy}>
                <Text style={styles.contestToggleTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {cs.photoDiary.addToContest}
                </Text>
                <Text style={styles.contestToggleHint} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.photoDiary.addToContestHint}
                </Text>
              </View>
              <View style={[styles.toggleTrack, enterContest && styles.toggleTrackActive]}>
                <View style={[styles.toggleThumb, enterContest && styles.toggleThumbActive]} />
              </View>
            </Pressable>

            <View style={styles.saveWrap}>
              <GlowButton
                label={enterContest ? cs.photoDiary.saveAndEnterContest : cs.photoDiary.save}
                onPress={() => void handleSave()}
                glow="soft"
                height={56}
              />
            </View>
          </KeyboardAwareScrollView>
        </View>
      </View>

      <PubPickerModal
        visible={pickerVisible}
        candidates={nearby.candidates}
        selectedKey={pub?.pubKey ?? null}
        onSelect={handleSelectPub}
        onClose={() => setPickerVisible(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.7),
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: {
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 1.2,
    color: Colors.amber,
    textTransform: 'uppercase',
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
