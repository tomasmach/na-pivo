/**
 * The evening card — the middle of the counter screen.
 *
 * One card holds the whole night: the count as a big amber numeral on the left,
 * the glass filling up on the right, and a footer of two quiet facts (money,
 * how long ago) with the door into "Tvůj účet". That composition is deliberate:
 * the previous version put the number alone on a bare background and the screen
 * read as a wireframe with a hole in the middle.
 *
 * Type scale on this screen is four steps: display numeral / 20 title /
 * 15 body / 13 caption. Spacing runs on the 8-point grid.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { BeerGlass } from '@/counter/BeerGlass';

/** The numeral shrinks as the night grows so "12" never crowds the card. */
function countFontSize(count: number): number {
  if (count < 10) return 88;
  if (count < 100) return 72;
  return 56;
}

export interface CoasterCardProps {
  /** Number of beers tonight at this place. */
  count: number;
  /** The declined noun for the count ("pivo" / "piva" / "piv"). */
  nounLabel: string;
  /** Money spent, pre-formatted, or null when unknown (outside a pub). */
  spentLabel: string | null;
  /** "před 9 min" / "právě teď", or null before the first beer. */
  sinceLabel: string | null;
  /** Render the "Účet" footer (true when the session has >= 1 drink). */
  showReceipt: boolean;
  /** The whole card AND the footer open the receipt. */
  onOpenReceipt: () => void;
  accessibilityLabel: string;
}

export function CoasterCard({
  count,
  nounLabel,
  spentLabel,
  sinceLabel,
  showReceipt,
  onOpenReceipt,
  accessibilityLabel,
}: CoasterCardProps) {
  const reducedMotion = useReducedMotion();
  const countScale = useSharedValue(1);
  const prevCountRef = useRef(count);

  // The peak moment of the app: a beer just landed, so the number pops once.
  // Never on mount, never on a decrease, nothing loops.
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (count > prev && !reducedMotion) {
      countScale.value = withSequence(
        withTiming(1.12, { duration: 130 }),
        withTiming(1, { duration: 180 }),
      );
    }
  }, [count, reducedMotion, countScale]);

  const countAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: countScale.value }],
  }));

  // The glass is sized from the card, not the other way round: on a short phone
  // it shrinks instead of spilling over the card's edge.
  const [bodyHeight, setBodyHeight] = useState(0);
  const glassWidth = bodyHeight > 0 ? Math.max(64, Math.min(112, (bodyHeight - 16) * 0.66)) : 88;

  const interactive = count > 0;
  const hasFooter = showReceipt && (spentLabel !== null || sinceLabel !== null || count > 0);

  return (
    <Pressable
      onPress={interactive ? onOpenReceipt : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, interactive && pressed && styles.pressed]}
    >
      <View
        style={styles.body}
        onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}
      >
        <View style={styles.countColumn}>
          <Animated.View style={countAnimatedStyle}>
            <Text
              style={[
                styles.count,
                // The line box must clear the extrabold glyph's overshoot, or
                // iOS shaves the top off the digits. 1.24 leaves real headroom;
                // the noun's negative margin closes the gap it creates below.
                { fontSize: countFontSize(count), lineHeight: countFontSize(count) * 1.24 },
              ]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.display}
            >
              {count}
            </Text>
          </Animated.View>
          <Text style={styles.noun} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {count > 0 ? nounLabel.toUpperCase() : cs.counter.coasterEmpty}
          </Text>
        </View>
        <BeerGlass count={count} width={glassWidth} />
      </View>

      {hasFooter ? (
        <View style={styles.footer}>
          <View style={styles.facts}>
            {spentLabel !== null ? (
              <Text style={styles.fact} maxFontSizeMultiplier={FontScaleCap.body}>
                {spentLabel}
              </Text>
            ) : null}
            {sinceLabel !== null ? (
              <Text style={styles.factMuted} maxFontSizeMultiplier={FontScaleCap.body}>
                {sinceLabel}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onOpenReceipt}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.counterReceiptChip}
            style={({ pressed }) => [styles.receiptLink, pressed && styles.pressed]}
          >
            <Text style={styles.receiptLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.receiptChip}
            </Text>
            <ChevronRightIcon size={15} color={Colors.amber} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The card takes the whole space between the header and the button, so the
  // screen has no dead middle and the glass gets room to be the hero. It clips
  // its own contents: the glass is sized from the card, never the other way.
  card: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  pressed: {
    opacity: 0.85,
  },
  body: {
    flex: 1,
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
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    includeFontPadding: false,
    // Tabular figures so the digit never shifts sideways as the night grows.
    fontVariant: ['tabular-nums'],
  },
  // Small, wide, unlit: a caption for the numeral, not a headline of its own.
  // Pulled up into the numeral's line-box headroom so the pair reads as one
  // object instead of two stacked labels.
  noun: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
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
  facts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  fact: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  factMuted: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  receiptLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingLeft: 8,
  },
  receiptLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
});
