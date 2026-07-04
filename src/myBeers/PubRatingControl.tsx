/**
 * The personal pub rating control — "Stálo to za to?".
 *
 * Three layers, all private and local (pubRatingsStore) — nothing is sent
 * anywhere:
 *   1. a thumb verdict (good / weak),
 *   2. optional memory tags ("Vrátím se sem" …), one at a time,
 *   3. a free-text note in the user's own words.
 *
 * Tapping an active verdict / tag clears it, so a rating is always editable.
 * The note is held in local state while typing and committed to the store on
 * every change (cheap, local-only). Keyed by `pubKey` (geohash-8 cell) so it
 * lines up with the pub's evenings.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import {
  ThumbsUpIcon,
  ThumbsDownIcon,
  MessageSquareIcon,
} from '@/components/shared/IconGlyph';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  usePubRatingsStore,
  selectPubRating,
  type PubVerdict,
} from '@/stores/pubRatingsStore';

const NOTE_MAX_LENGTH = 280;

interface PubRatingControlProps {
  pubKey: string;
  pubName: string;
}

function tap() {
  if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
}

export function PubRatingControl({ pubKey, pubName }: PubRatingControlProps) {
  const rating = usePubRatingsStore(selectPubRating(pubKey));
  const setRating = usePubRatingsStore((s) => s.setRating);

  const verdict = rating?.verdict;
  const tag = rating?.tag;

  // The note lives in local state while editing so the cursor never jumps; the
  // store is the source of truth and is re-seeded when the pub changes. We track
  // the active pubKey and reset the draft during render (the React-recommended
  // alternative to a setState-in-effect) rather than after a commit.
  const [noteDraft, setNoteDraft] = useState(() => rating?.note ?? '');
  const [activePubKey, setActivePubKey] = useState(pubKey);
  if (pubKey !== activePubKey) {
    setActivePubKey(pubKey);
    setNoteDraft(usePubRatingsStore.getState().ratings[pubKey]?.note ?? '');
  }

  const chooseVerdict = useCallback(
    (next: PubVerdict) => {
      tap();
      // Tapping the active verdict again clears it (still editable).
      setRating(pubKey, { verdict: verdict === next ? undefined : next });
    },
    [pubKey, setRating, verdict],
  );

  const chooseTag = useCallback(
    (preset: string) => {
      tap();
      setRating(pubKey, { tag: tag === preset ? undefined : preset });
    },
    [pubKey, setRating, tag],
  );

  const changeNote = useCallback(
    (text: string) => {
      setNoteDraft(text);
      setRating(pubKey, { note: text });
    },
    [pubKey, setRating],
  );

  return (
    <View>
      <View style={styles.sectionHeader}>
        <ThumbsUpIcon size={14} color={Colors.amber} />
        <Text style={styles.sectionHeaderText} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.myBeers.ratingHeader}
        </Text>
      </View>

      {/* Thumb verdict */}
      <View style={styles.verdictRow}>
        <Pressable
          onPress={() => chooseVerdict('like')}
          style={({ pressed }) => [
            styles.verdictButton,
            verdict === 'like' && styles.verdictLikeActive,
            pressed && styles.buttonPressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: verdict === 'like' }}
          accessibilityLabel={cs.a11y.ratingLike(pubName)}
          hitSlop={4}
        >
          <ThumbsUpIcon
            size={18}
            color={verdict === 'like' ? Colors.stout : Colors.foamMuted}
          />
          <Text
            style={[styles.verdictText, verdict === 'like' && styles.verdictTextLikeActive]}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.myBeers.verdictLike}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => chooseVerdict('dislike')}
          style={({ pressed }) => [
            styles.verdictButton,
            verdict === 'dislike' && styles.verdictDislikeActive,
            pressed && styles.buttonPressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: verdict === 'dislike' }}
          accessibilityLabel={cs.a11y.ratingDislike(pubName)}
          hitSlop={4}
        >
          <ThumbsDownIcon
            size={18}
            color={verdict === 'dislike' ? Colors.foam : Colors.foamMuted}
          />
          <Text
            style={[styles.verdictText, verdict === 'dislike' && styles.verdictTextDislikeActive]}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.myBeers.verdictDislike}
          </Text>
        </Pressable>
      </View>

      {/* Memory tags */}
      <Text style={[styles.subLabel, styles.tagLabel]} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.myBeers.tagLabel}
      </Text>
      <View style={styles.tagGrid}>
        {cs.myBeers.notePresets.map((preset) => {
          const active = tag === preset.value;
          return (
            <Pressable
              key={preset.value}
              onPress={() => chooseTag(preset.value)}
              style={({ pressed }) => [
                styles.tagChip,
                active && styles.tagChipActive,
                pressed && styles.buttonPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={cs.a11y.ratingNote(preset.label)}
              hitSlop={4}
            >
              <Text
                style={[styles.tagChipText, active && styles.tagChipTextActive]}
                maxFontSizeMultiplier={FontScaleCap.body}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.86}
              >
                {preset.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Free-text note */}
      <View style={styles.noteLabelRow}>
        <MessageSquareIcon size={13} color={Colors.mutedText} />
        <Text style={styles.subLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.myBeers.noteLabel}
        </Text>
      </View>
      <TextInput
        style={styles.noteInput}
        value={noteDraft}
        onChangeText={changeNote}
        placeholder={cs.myBeers.notePlaceholder}
        placeholderTextColor={Colors.mutedText}
        multiline
        maxLength={NOTE_MAX_LENGTH}
        textAlignVertical="top"
        accessibilityLabel={cs.a11y.ratingNoteInput(pubName)}
        maxFontSizeMultiplier={FontScaleCap.body}
      />

      <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.myBeers.ratingHint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  sectionHeaderText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },

  verdictRow: {
    flexDirection: 'row',
    gap: 10,
  },
  verdictButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  verdictLikeActive: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  verdictDislikeActive: {
    backgroundColor: Colors.stout3,
    borderColor: Colors.mutedText,
  },
  verdictText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  verdictTextLikeActive: {
    color: Colors.stout,
  },
  verdictTextDislikeActive: {
    color: Colors.foam,
  },

  // Small muted label above the tag row and the note field.
  subLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  // Extra breathing room between the verdict buttons and the quick-tag label.
  tagLabel: {
    marginTop: 20,
  },

  tagGrid: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  tagChip: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tagChipActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  tagChipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    color: Colors.foamMuted,
  },
  tagChipTextActive: {
    color: Colors.stout,
  },

  noteLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 18,
    marginBottom: 8,
  },
  noteInput: {
    minHeight: 76,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foam,
  },

  hint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    marginTop: 14,
  },
});
