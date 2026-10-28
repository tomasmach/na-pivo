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
 * The one bit of motion here is the reaction to a beer landing: each digit that
 * changed rolls up like the drum of a hand tally counter. It never runs on mount
 * or when the count drops, and reduced motion swaps the digit in place.
 *
 * The numeral is sized from the measured card rather than from the fixed
 * four-step scale, so the display step is a floor here, not a ceiling: it grows
 * into whatever the rows below leave it, and never past `COUNT_MAX`.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated, {
  Easing,
  LinearTransition,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';

/** Nothing on any screen is bigger than this. */
const COUNT_MAX = 132;
/** Below this it stops being a display numeral, so the card would rather clip. */
const COUNT_MIN = 44;
/** Fallback for the first frame, before the card has been measured. */
const COUNT_FALLBACK = 88;
/** Room the letterspaced noun needs under the numeral (its -8 overlap included). */
const NOUN_ROOM = 14;
const ROLL_MS = 290;
/**
 * How much of the 1.24x line box a digit window shows, from its top. By the
 * font's metrics Baloo's digits end near 0.73 of the size on iOS and 0.86 on
 * Android, so 0.95 clears both and stops above the noun, which the -18 margin
 * pulls up into the line box; a full-height window rolled digits across it.
 */
const ROLL_WINDOW = 0.95;
/** Overshoots by a hair and settles, like a drum clicking into its detent. */
const ROLL_EASING = Easing.bezier(0.3, 1.22, 0.55, 1);
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

function rollIn(distance: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { transform: [{ translateY: distance }] },
      animations: {
        transform: [{ translateY: withTiming(0, { duration: ROLL_MS, easing: ROLL_EASING }) }],
      },
    };
  };
}

function rollAway(distance: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { transform: [{ translateY: 0 }] },
      animations: {
        transform: [{ translateY: withTiming(-distance, { duration: ROLL_MS, easing: ROLL_EASING }) }],
      },
    };
  };
}

/**
 * One fixed-width window per digit, keyed from the right so 9 -> 10 rolls the
 * units and brings the tens in from below. The digit that leaves is a copy that
 * mounts already rolling up and then rests out of sight: exiting animations
 * could not be switched off for a drop, and a drop must not roll.
 */
function RollingNumeral({
  count,
  size,
  style,
}: {
  count: number;
  size: number;
  style: StyleProp<TextStyle>;
}) {
  const lineHeight = size * 1.24;
  const travel = Math.round(size * ROLL_WINDOW);
  const [roll, setRoll] = useState({ count, previous: String(count), rising: false, epoch: 0 });
  if (count !== roll.count) {
    setRoll({ count, previous: String(roll.count), rising: count > roll.count, epoch: roll.epoch + 1 });
  }
  const entering = useMemo(() => rollIn(travel), [travel]);
  const leaving = useMemo(() => rollAway(travel), [travel]);
  // 9 -> 10 adds a window and re-centres the row; let the old digit slide over with the roll.
  const recentre = useMemo(() => LinearTransition.duration(ROLL_MS).easing(ROLL_EASING), []);
  const digits = String(Math.max(0, Math.floor(count))).split('');
  const previous = roll.previous.split('');
  const digitBox = { width: Math.round(size * DIGIT_ADVANCE), height: travel };
  const text = [style, styles.digit, { fontSize: size, lineHeight }];

  return (
    <View style={[styles.digits, { height: lineHeight }]}>
      {digits.map((digit, index) => {
        const place = digits.length - index;
        const before = previous[previous.length - place];
        const rolls = roll.rising && before !== digit;
        return (
          <Animated.View
            key={place}
            layout={roll.rising ? recentre : undefined}
            style={[styles.digitWindow, digitBox]}
          >
            {rolls && before !== undefined ? (
              <Animated.Text
                key={`away-${roll.epoch}`}
                entering={leaving}
                style={[text, { transform: [{ translateY: -travel }] }]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {before}
              </Animated.Text>
            ) : null}
            <Animated.Text
              key={digit}
              entering={rolls ? entering : undefined}
              style={text}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {digit}
            </Animated.Text>
          </Animated.View>
        );
      })}
    </View>
  );
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
  /** The alcohol estimate band, ruled off above and directly above the footer. */
  estimate?: React.ReactNode;
  /**
   * The short bottom half of a phone lying open on a table: the numeral on the
   * left, the rows and the footer beside it instead of under it.
   */
  sideways?: boolean;
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
  estimate,
  sideways = false,
}: CoasterCardProps) {
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

  const numeral = (
    <Pressable
      style={sideways ? styles.sideBody : styles.body}
      onLayout={handleBodyLayout}
      onPress={interactive ? onOpenReceipt : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel}
    >
      {/* The line box must clear the extrabold glyph's overshoot, or iOS shaves
          the top off the digits; the noun's negative margin closes the gap below. */}
      <RollingNumeral count={count} size={numeralSize} style={styles.count} />
      <Text style={styles.noun} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {(count > 0 ? nounLabel : t.counter.coasterEmpty).toUpperCase()}
      </Text>
    </Pressable>
  );

  const footer = hasFooter ? (
    <View
      style={[
        styles.footer,
        estimate ? styles.footerAfterEstimate : null,
        sideways && !estimate ? styles.footerSideways : null,
      ]}
    >
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
        accessibilityLabel={t.a11y.counterReceiptChip}
        style={({ pressed }) => [styles.receiptLink, pressed && styles.pressed]}
      >
        <Text style={styles.receiptLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.counter.receiptChip}
        </Text>
        <ChevronRightIcon size={15} color={Colors.amber} />
      </Pressable>
    </View>
  ) : null;

  return (
    <Pressable
      testID="counter-count"
      onPress={interactive ? onOpenReceipt : undefined}
      disabled={!interactive}
      accessible={false}
      focusable={false}
      style={({ pressed }) => [styles.card, sideways && styles.cardSideways, interactive && pressed && styles.pressed]}
    >
      <CardSheen />
      {numeral}
      {sideways ? (
        <View style={styles.sideRows}>
          {children}
          {estimate}
          {footer}
        </View>
      ) : (
        <>
          {children}
          {estimate}
          {footer}
        </>
      )}
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
  cardSideways: {
    flexDirection: 'row',
    gap: 22,
    paddingTop: 4,
    paddingBottom: 4,
  },
  sideBody: {
    width: '34%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The rows keep their own spacing; centred so a short evening does not hang from the top.
  sideRows: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  digits: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  digitWindow: {
    overflow: 'hidden',
  },
  digit: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  count: {
    fontFamily: Fonts.display.extrabold,
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
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
    textAlign: 'center',
  },
  footer: CardSurface.footer,
  // The estimate band already ends in its own breathing room; another 20 would
  // push its text off the middle between the two hairlines.
  footerAfterEstimate: {
    marginTop: 0,
  },
  footerSideways: {
    marginTop: 8,
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
