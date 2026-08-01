/**
 * NightCard — the hero of the "Deník" screen: the last evening, in one card.
 *
 * It is the direct sibling of `CoasterCard`: same card recipe, same four-step
 * type scale (display numeral / 20 title / 15 body / 13 caption), same hairline
 * footer. Only the contents differ — a quiet date eyebrow on top, the stack of
 * coasters instead of the filling glass, and a footer that pairs the place with
 * the money and the door into the night's breakdown.
 *
 * The rule this file enforces: the count is the only lit thing here. The card
 * carries no amber frame and no glow — the glow belongs to the screen's one
 * button. The numeral's line box is kept at 1.24x its size, because Baloo 2
 * ExtraBold overshoots and iOS otherwise shaves the tops off the digits.
 *
 * Purely presentational: props in, callbacks out. The parent has already
 * declined the noun, formatted the money and decided what "when" reads as.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { TallyCoaster } from '@/diary/TallyCoaster';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

/** The numeral shrinks as the night grows so "12" never crowds the card. */
function countFontSize(count: number): number {
  if (count < 10) return 88;
  if (count < 100) return 72;
  return 56;
}

export interface NightCardProps {
  /** How many drinks landed that night. */
  count: number;
  /** Declined and uppercased by the parent ("PIV", "PANÁKY"). */
  nounLabel: string;
  /** "Dnes" / "Včera" / "12. 6." — may already carry " · pořád běží". */
  whenLabel: string;
  /** Pub name, or the context the night happened in. */
  placeLabel: string;
  /** Pre-formatted money ("1 045 Kč"), or null when the price is unknown. */
  spentLabel: string | null;
  /** Total evenings on record — drives the depth of the coaster stack. */
  nights: number;
  /** Both the whole card and the footer link open the night's breakdown. */
  onPress: () => void;
  accessibilityLabel: string;
  /**
   * Lets the screen hand the card the leftover space when it is the only thing
   * in the scroll — otherwise a single recorded night leaves a dead hole in the
   * middle of the screen and the layout reads as a wireframe.
   */
  style?: StyleProp<ViewStyle>;
}

export function NightCard({
  count,
  nounLabel,
  whenLabel,
  placeLabel,
  spentLabel,
  nights,
  onPress,
  accessibilityLabel,
  style,
}: NightCardProps) {
  // The coaster stack is sized from the card, not the other way round: on a
  // short phone it shrinks instead of spilling over the card's edge.
  const [bodyHeight, setBodyHeight] = useState(0);
  const coasterWidth = bodyHeight > 0 ? Math.max(64, Math.min(120, (bodyHeight - 16) * 0.66)) : 88;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}
    >
      <CardSheen />

      {/* Where you were is the card's title, exactly as the place chip is the
          counter's — the date rides beside it as quiet context. */}
      <View style={styles.titleRow}>
        <Text style={styles.place} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {placeLabel}
        </Text>
      </View>
      <Text style={styles.eyebrow} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {whenLabel}
      </Text>

      <View
        style={styles.body}
        onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
      >
        <View style={styles.countColumn}>
          <Text
            style={[
              styles.count,
              // The line box must clear the extrabold glyph's overshoot, or iOS
              // shaves the top off the digits. 1.24 leaves real headroom; the
              // noun's negative margin closes the gap it creates below.
              { fontSize: countFontSize(count), lineHeight: countFontSize(count) * 1.24 },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {count}
          </Text>
          <Text style={styles.noun} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {count > 0 ? nounLabel : cs.diary.emptyNoun}
          </Text>
        </View>
        <TallyCoaster marks={count} nights={nights} width={coasterWidth} />
      </View>

      {/* Etalon footer: one loud fact, one quiet one, one door. */}
      <View style={styles.footer}>
        <View style={styles.facts}>
          {spentLabel !== null ? (
            <Text style={styles.spent} maxFontSizeMultiplier={FontScaleCap.body}>
              {spentLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.footerRight}>
          <Pressable
            onPress={onPress}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.diaryBreakdown}
            style={({ pressed }) => [styles.breakdownLink, pressed && styles.pressed]}
          >
            <Text style={styles.breakdownLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.diary.breakdownLink}
            </Text>
            <ChevronRightIcon size={15} color={Colors.amber} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Unlike the counter's CoasterCard this one sits at the top of a scroll, not
  // in a fixed composition — so its height comes from a deliberate minimum, not
  // from `flex: 1` (which collapses inside a ScrollView's content container and
  // would squash the numeral and the mat down to nothing). It still clips its
  // own contents: the coaster is sized from the card, never the other way.
  card: CardSurface.card,
  pressed: {
    opacity: 0.85,
  },
  eyebrow: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  // `flex: 1` lets the body absorb whatever height the card is given, so the
  // footer stays pinned to the bottom edge instead of floating mid-card; the
  // minimum is the safety net for when the card is only as tall as its content
  // (inside a scroll, where `flex` has nothing to divide). 132 is the 88pt
  // numeral's line box plus room for the mat.
  body: {
    flex: 1,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  countColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  count: {
    fontWeight: '800',
    color: Colors.amber,
    includeFontPadding: false,
    // Tabular figures so the digit never shifts sideways between nights.
    fontVariant: ['tabular-nums'],
  },
  // Small, wide, unlit: a caption for the numeral, not a headline of its own.
  // Pulled up into the numeral's line-box headroom so the pair reads as one
  // object instead of two stacked labels.
  noun: {
    marginTop: -8,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  footer: {
    marginTop: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  // Without flexShrink a long pub name pushes the link off the card instead of
  // truncating. "Restaurace U Zlatého Tygra na Starém Městě" is the test case.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  // The pub is the card's headline, sized like the counter's place chip, so a
  // long name gets the full card width instead of a third of the footer.
  place: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  facts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  spent: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  breakdownLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
  },
  breakdownLabel: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
});
