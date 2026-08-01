/**
 * The evening card — the middle of the counter screen.
 *
 * Top to bottom: how many beers you've had tonight as the one big number, then
 * whatever the screen hands in as `children` (the quick actions and the social
 * rail), then a footer of two quiet facts (money, how long ago) beside the door
 * into "Tvůj účet".
 *
 * There is deliberately no illustration. A drawn half-litre mug lived here and
 * was a picture OF a beer where the screen wanted the count; pencil čárky beside
 * the numeral then said the same thing twice. Both are gone, and the room they
 * were taking went to things that do something: a beer that isn't the last one,
 * mapping the pub, the parta, the boards.
 *
 * The numeral is sized from the measured card rather than from the fixed
 * four-step scale, so the display step is a floor here, not a ceiling: it grows
 * into whatever the rows below leave it, and never past `COUNT_MAX`.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

/** Nothing on any screen is bigger than this. */
const COUNT_MAX = 132;
/** Below this it stops being a display numeral, so the card would rather clip. */
const COUNT_MIN = 44;
/** Fallback for the first frame, before the card has been measured. */
const COUNT_FALLBACK = 88;
/** Room the letterspaced noun needs under the numeral (its -8 overlap included). */
const NOUN_ROOM = 14;
/**
 * Rough advance width of one Baloo 2 ExtraBold digit as a share of its size.
 * Keeps "128" inside the card instead of trusting `adjustsFontSizeToFit`, which
 * only kicks in once the glyphs have already been laid out — and a numeral that
 * quietly auto-shrinks is a numeral whose size nobody controls.
 */
const DIGIT_ADVANCE = 0.62;

/**
 * Size the numeral from the card: as large as the measured body allows, never
 * past `COUNT_MAX`, and never wider than the card whatever the digit count.
 *
 * Exported for the test that pins it — this is the one number on the screen, and
 * "three digits overflow on an SE" is exactly the bug nothing else catches.
 */
export function countNumeralSize(count: number, width: number, height: number): number {
  if (width <= 0 || height <= 0) return COUNT_FALLBACK;

  const digits = Math.max(1, String(Math.max(0, Math.floor(count))).length);
  const byHeight = (height - NOUN_ROOM) / 1.24;
  const byWidth = width / (digits * DIGIT_ADVANCE);

  return Math.round(Math.max(COUNT_MIN, Math.min(COUNT_MAX, byHeight, byWidth)));
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
  /**
   * Rows between the numeral and the footer: the quick actions and the social
   * rail. The card owns their vertical rhythm and nothing else about them.
   */
  children?: React.ReactNode;
}

export function CoasterCard({
  count,
  nounLabel,
  spentLabel,
  sinceLabel,
  showReceipt,
  onOpenReceipt,
  accessibilityLabel,
  children,
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

  // The numeral is sized from the card, never the other way round: on a short
  // phone it shrinks instead of spilling over the rounded corner.
  const [body, setBody] = useState({ width: 0, height: 0 });
  const handleBodyLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    const next = { width: Math.round(width), height: Math.round(height) };
    if (next.width <= 0 || next.height <= 0) return;
    setBody((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    );
  };
  const numeralSize = countNumeralSize(count, body.width, body.height);

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
      <CardSheen />

      <View style={styles.body} onLayout={handleBodyLayout}>
        <Animated.View style={countAnimatedStyle}>
          <Text
            style={[
              styles.count,
              // The line box must clear the extrabold glyph's overshoot, or iOS
              // shaves the top off the digits. 1.24 leaves real headroom; the
              // noun's negative margin closes the gap it creates below.
              { fontSize: numeralSize, lineHeight: numeralSize * 1.24 },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {count}
          </Text>
        </Animated.View>
        <Text style={styles.noun} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {(count > 0 ? nounLabel : cs.counter.coasterEmpty).toUpperCase()}
        </Text>
      </View>

      {children}

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
  // screen has no dead middle and the numeral has room to be the hero. It clips
  // its own contents: the numeral is sized from the card, never the other way.
  card: {
    ...CardSurface.card,
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
  // Number and noun are one object, centred in whatever height the card got.
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    fontWeight: '800',
    color: Colors.amber,
    includeFontPadding: false,
    textAlign: 'center',
    // Tabular figures so the digit never shifts sideways as the night grows.
    fontVariant: ['tabular-nums'],
  },
  // Small, wide, unlit: a caption for the numeral, not a headline of its own.
  // Pulled up into the numeral's line-box headroom so the pair reads as one
  // object instead of two stacked labels.
  noun: {
    marginTop: -18,
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
    textAlign: 'center',
  },
  footer: CardSurface.footer,
  facts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  fact: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  factMuted: {
    fontWeight: '500',
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
    fontWeight: '600',
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
});
