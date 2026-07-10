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
  ScrollView,
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
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { fireSuccessHaptic } from '@/utils/haptics';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';

const CAPTION_MAX = 280;

/** The tag the diary stores: durable geohash-8 key + display name/city. */
interface PhotoPubTag {
  pubKey: string;
  name: string;
  city: string;
}

interface BeerPhotoComposeSheetProps {
  /** Downscaled JPEG from the picker (cache uri — persisted durably on save). */
  pickedUri: string;
  onClose: () => void;
  /** Fired after the photo is queued (sheet already closable). */
  onSaved: () => void;
}

/** An active counter session pins its pub as the initial tag suggestion. */
function tallyPubSuggestion(): PhotoPubTag | null {
  const current = useTallyStore.getState().current;
  if (!current || !current.pubName) return null;
  return { pubKey: current.pubKey, name: current.pubName, city: '' };
}

export function BeerPhotoComposeSheet({ pickedUri, onClose, onSaved }: BeerPhotoComposeSheetProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const showToast = useToastStore((s) => s.show);

  const [caption, setCaption] = useState('');
  const [manualPub, setManualPub] = useState<PhotoPubTag | null>(null);
  // Once the user clears the tag, no auto-suggestion may sneak back in.
  const [pubCleared, setPubCleared] = useState(false);
  const [visibility, setVisibility] = useState<BeerPhotoVisibility>('friends');
  const [pickerVisible, setPickerVisible] = useState(false);
  const savingRef = useRef(false);

  const nearby = useNearbyPub();

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
    void enqueueBeerPhoto({
      clientId,
      localUri: durableUri,
      caption: caption.trim(),
      pubCacheKey: pub?.pubKey,
      pubName: pub?.name,
      pubCity: pub?.city,
      visibility,
      takenAt: new Date().toISOString(),
    });
    if (useSettingsStore.getState().hapticEnabled) fireSuccessHaptic();
    onSaved();
  }, [pickedUri, caption, pub, visibility, onSaved]);

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

          <ScrollView
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
              placeholderTextColor={Colors.mutedText}
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

            <View style={styles.saveWrap}>
              <GlowButton
                label={cs.photoDiary.save}
                onPress={() => void handleSave()}
                glow="soft"
                height={56}
              />
            </View>
          </ScrollView>
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
    fontFamily: Fonts.display.extrabold,
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
    fontFamily: Fonts.ui.bold,
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
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
  pubNameEmpty: {
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
  },
  segmentTextActive: {
    color: Colors.stout,
  },
  saveWrap: {
    marginTop: Spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
});
