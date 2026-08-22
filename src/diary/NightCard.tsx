/**
 * NightCard — the hero of the private diary: your last evening, in one card.
 *
 * It is the 3.0 reading of the etalon card (§5.1): the shared `CardSurface`
 * panel with its sheen, one big Baloo numeral in amber (§3), and a footer that
 * is a `StatGrid` — the same block the feed card, the party hub and the recap
 * use, so a night's numbers read identically wherever you meet them.
 *
 * What went, and why:
 *
 *   TallyCoaster   the mat drew tally marks beside a numeral that already said
 *                  the count — a drawing must carry data the number cannot (§9),
 *                  and this one carried the same data worse. The freed space
 *                  went to facts about the night that the count does not hold:
 *                  what it cost, how long it lasted, how fast it went.
 *   "Rozpis →"     the whole card already opens the same breakdown. Two paths to
 *                  one thing (§0.3, §14.4); the chevron on the title row is the
 *                  affordance now.
 *
 * Purely presentational: props in, callbacks out. The parent has declined the
 * noun, formatted the money and decided what "when" reads as.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { countNumeralSize } from '@/counter/CoasterCard';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { StatGrid, type Stat } from '@/mocks/StatGrid';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export interface NightCardProps {
  /** How many drinks landed that night. */
  count: number;
  /** Declined and uppercased by the parent ("PIV", "PANÁKY"). */
  nounLabel: string;
  /** "Dnes" / "Včera" / "12. 6." — may already carry " · pořád běží". */
  whenLabel: string;
  /** Pub name, or the context the night happened in. */
  placeLabel: string;
  /**
   * Three facts the numeral cannot hold: what it cost, how long it ran, how
   * fast it went. Already formatted; a missing one arrives as an em dash.
   */
  facts: Stat[];
  /** The whole card opens the night's breakdown. */
  onPress: () => void;
  accessibilityLabel: string;
  /**
   * Lets the screen hand the card the leftover space when it is the only thing
   * in the scroll — otherwise a single recorded night leaves a dead hole in the
   * middle of the screen and the layout reads as a wireframe (§14.1).
   */
  style?: StyleProp<ViewStyle>;
}

export function NightCard({
  count,
  nounLabel,
  whenLabel,
  placeLabel,
  facts,
  onPress,
  accessibilityLabel,
  style,
}: NightCardProps) {
  // The numeral is measured FROM the card, never guessed (§3.1, §5.3): it grows
  // into whatever the title and the footer leave it and shrinks on an SE, so a
  // three-digit night never overflows and a tall card never leaves a hole where
  // an 88pt figure floats in the middle of nothing.
  const [body, setBody] = useState({ width: 0, height: 0 });
  const size = countNumeralSize(count, body.width, body.height);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}
    >
      <CardSheen />

      {/* When it was rides above where it was: the date is the context, the pub
          is the headline. The chevron is the door — the card itself is it. */}
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Text style={styles.eyebrow} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {whenLabel}
          </Text>
          <Text style={styles.place} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {placeLabel}
          </Text>
        </View>
        <ChevronRightIcon size={18} color={Colors.mutedText} />
      </View>

      <View
        style={styles.body}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          const next = { width: Math.round(width), height: Math.round(height) };
          setBody((current) =>
            current.width === next.width && current.height === next.height ? current : next,
          );
        }}
      >
        <Text
          style={[
            styles.count,
            // The line box must clear the extrabold glyph's overshoot, or iOS
            // shaves the top off the digits. 1.24 leaves real headroom; the
            // noun's negative margin closes the gap it creates below (§3.2).
            { fontSize: size, lineHeight: size * 1.24 },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {count}
        </Text>
        <Text style={styles.noun} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {count > 0 ? nounLabel : cs.diary.emptyNoun}
        </Text>
      </View>

      <View style={styles.footer}>
        <StatGrid columns={3} compact stats={facts} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Unlike the counter's CoasterCard this one sits at the top of a scroll, not
  // in a fixed composition — so its height comes from its content, not from
  // `flex: 1` (which collapses inside a ScrollView's content container). The
  // screen still hands it `flex: 1` when it is the scroll's only child.
  card: CardSurface.card,
  pressed: { opacity: 0.85 },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  // Without flexShrink a long pub name pushes the chevron off the card instead
  // of truncating. "Restaurace U Zlatého Tygra na Starém Městě" is the test.
  titleText: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  place: {
    marginTop: 2,
    fontWeight: '800',
    fontSize: 20,
    letterSpacing: -0.3,
    color: Colors.foam,
    includeFontPadding: false,
  },

  // One breathing block, so the numeral owns whatever height the card is given
  // and the footer stays pinned to its bottom edge. The minimum is the safety
  // net inside a scroll, where flex has nothing to divide: the 88pt numeral's
  // line box plus its caption.
  //
  // Anchored to the bottom of whatever height the card is given, not centred:
  // when the diary holds a single night the card takes the whole scroll, and a
  // centred numeral then floats in the middle with dead space on both sides —
  // the wireframe look §14.1 bans. Bottom-anchored it reads as a poster: place
  // at the top, the number sitting on its own footer rule.
  body: {
    flex: 1,
    minHeight: 132,
    justifyContent: 'flex-end',
    marginTop: Spacing.lg,
  },
  count: {
    fontFamily: Fonts.numeral,
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
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
});
