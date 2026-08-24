/**
 * The cheers reaction — and the mugs actually clink when you tap it.
 *
 * §10 forbids looping motion and allows exactly one thing: a single pop in
 * response to a user action. This is that. Nothing moves until you touch it, and
 * it plays once.
 *
 * The motion is the gesture it depicts, in three beats:
 *
 *   1. wind up   the mugs lean apart a few degrees
 *   2. clink     they swing in and meet, sparks pop at the contact point
 *   3. settle    a spring brings them back, sparks fade
 *
 * Drawn from `CHEERS_MUG_PATHS`, the same shape `CheersIcon` uses, so the static
 * glyph in the tab bar and this animated one cannot drift. Two copies of one
 * mug, the left one mirrored.
 *
 * `useReducedMotion()` skips straight to the state change — the count still
 * updates, it just does not swing.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path as SvgPath } from 'react-native-svg';

import { CHEERS_MUG_PATHS, CHEERS_SPARK_PATHS } from '@/components/shared/IconGlyph';
import { Colors } from '@/theme/colors';

/** Rest tilt, and how far in they swing to meet. */
const REST_TILT = 14;
const CLINK_TILT = 30;
const WIND_UP_TILT = 8;

const SPRING = { damping: 9, stiffness: 320, mass: 0.5 } as const;

function Mug({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size * 0.62} height={size} viewBox="-7 -9.5 14 19" fill="none">
      {CHEERS_MUG_PATHS.map((d) => (
        <SvgPath
          key={d}
          d={d}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

export function CheersButton({
  count,
  cheered,
  onPress,
  disabled = false,
  size = 19,
  label,
}: {
  count: number;
  cheered: boolean;
  onPress?: () => void;
  disabled?: boolean;
  size?: number;
  /** Accessibility label — the count in words. */
  label: string;
}) {
  const reducedMotion = useReducedMotion();
  const swing = useSharedValue(0);
  const spark = useSharedValue(0);

  const color = cheered ? Colors.amber : Colors.mutedText;

  const clink = () => {
    if (disabled) return;
    onPress?.();
    if (reducedMotion) return;
    // −1 is wound up (apart), +1 is met. The sparks land on the meeting beat.
    swing.value = withSequence(
      withTiming(-1, { duration: 90 }),
      withSpring(1, SPRING),
      withSpring(0, SPRING),
    );
    spark.value = withSequence(
      withTiming(0, { duration: 90 }),
      withTiming(1, { duration: 70 }),
      withTiming(0, { duration: 220 }),
    );
  };

  // One shared value drives both mugs; the left one reads it mirrored.
  // Written out twice rather than through a helper, because a hook called from
  // a plain function is a rules-of-hooks violation even when the call order is
  // stable.
  const rightStyle = useAnimatedStyle(() => {
    const swung = swing.value;
    const degrees =
      swung >= 0
        ? REST_TILT + swung * (CLINK_TILT - REST_TILT)
        : REST_TILT + swung * (REST_TILT - WIND_UP_TILT);
    return {
      transform: [
        { translateX: -Math.max(0, swung) * 1.5 },
        { rotate: `${degrees}deg` },
      ],
    };
  });

  const leftStyle = useAnimatedStyle(() => {
    const swung = swing.value;
    const degrees =
      swung >= 0
        ? REST_TILT + swung * (CLINK_TILT - REST_TILT)
        : REST_TILT + swung * (REST_TILT - WIND_UP_TILT);
    return {
      transform: [
        { translateX: Math.max(0, swung) * 1.5 },
        { rotate: `${-degrees}deg` },
      ],
    };
  });

  const sparkStyle = useAnimatedStyle(() => ({
    opacity: spark.value,
    transform: [{ scale: 0.7 + spark.value * 0.5 }],
  }));

  return (
    <Pressable
      onPress={clink}
      disabled={disabled}
      style={({ pressed }) => [
        styles.wrap,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: cheered }}
      hitSlop={8}
    >
      <View style={[styles.glyph, { width: size * 1.18, height: size }]}>
        <Animated.View style={[styles.mug, styles.mugLeft, leftStyle]}>
          <View style={styles.mirror}>
            <Mug size={size} color={color} />
          </View>
        </Animated.View>
        <Animated.View style={[styles.mug, styles.mugRight, rightStyle]}>
          <Mug size={size} color={color} />
        </Animated.View>
        <Animated.View style={[styles.sparks, sparkStyle]} pointerEvents="none">
          <Svg width={size} height={size * 0.5} viewBox="-6 -11 12 6" fill="none">
            {CHEERS_SPARK_PATHS.map((d) => (
              <SvgPath key={d} d={d} stroke={color} strokeWidth={2} strokeLinecap="round" />
            ))}
          </Svg>
        </Animated.View>
      </View>

      <Text style={[styles.count, cheered && styles.countOn]} allowFontScaling={false}>
        {count}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.72 },

  glyph: { justifyContent: 'center' },
  mug: { position: 'absolute', bottom: 0 },
  mugLeft: { left: 0 },
  mugRight: { right: 0 },
  mirror: { transform: [{ scaleX: -1 }] },
  sparks: { position: 'absolute', top: -2, alignSelf: 'center' },

  count: { fontSize: 15, fontWeight: '700', color: Colors.mutedText },
  countOn: { color: Colors.amber },
});
