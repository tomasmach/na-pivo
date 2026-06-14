/**
 * The personal pub rating control — "Stálo to za to?".
 *
 * Two thumb buttons (good / weak) plus optional preset notes the user keeps as
 * their own memory of a place. Everything is private and local (pubRatingsStore)
 * — nothing is sent anywhere. Tapping an active choice clears it, so a rating is
 * always editable. Keyed by `pubKey` (geohash-8 cell) so it lines up with the
 * pub's evenings.
 */

import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { ThumbsUpIcon, ThumbsDownIcon } from '@/components/shared/IconGlyph';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  usePubRatingsStore,
  selectPubRating,
  type PubVerdict,
} from '@/stores/pubRatingsStore';

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
  const note = rating?.note;

  const chooseVerdict = useCallback(
    (next: PubVerdict) => {
      tap();
      // Tapping the active verdict again clears it (still editable).
      setRating(pubKey, { verdict: verdict === next ? undefined : next });
    },
    [pubKey, setRating, verdict],
  );

  const chooseNote = useCallback(
    (preset: string) => {
      tap();
      setRating(pubKey, { note: note === preset ? undefined : preset });
    },
    [pubKey, setRating, note],
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
          style={[styles.verdictButton, verdict === 'like' && styles.verdictLikeActive]}
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
          style={[styles.verdictButton, verdict === 'dislike' && styles.verdictDislikeActive]}
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

      {/* Optional preset notes */}
      <View style={styles.noteRow}>
        {cs.myBeers.notePresets.map((preset) => {
          const active = note === preset;
          return (
            <Pressable
              key={preset}
              onPress={() => chooseNote(preset)}
              style={[styles.noteChip, active && styles.noteChipActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={cs.a11y.ratingNote(preset)}
              hitSlop={4}
            >
              <Text
                style={[styles.noteChipText, active && styles.noteChipTextActive]}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {preset}
              </Text>
            </Pressable>
          );
        })}
      </View>

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

  noteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  noteChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteChipActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  noteChipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  noteChipTextActive: {
    color: Colors.stout,
  },

  hint: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    marginTop: 12,
  },
});
