/**
 * A real cube, in real perspective — six faces placed in space, not a picture
 * of a die.
 *
 * How, without adding a 3D engine: React Native's transform stack has
 * `perspective`, `rotateX` and `rotateY`, which is all a cube needs. The one
 * missing piece is `translateZ`, which RN does not support — so each face is
 * placed with `rotateY(90°) → translateX(half) → rotateY(-90°)`. Rotating the
 * coordinate frame, moving along its new X, then rotating back lands the face at
 * a Z offset with its original orientation. That is a genuine 3D placement, done
 * with the transforms that exist.
 *
 * The alternative was `expo-gl` + three.js: a renderer, a mesh and a physics
 * step, three new dependencies and a GL context, for two cubes that are on
 * screen for under a second. That is a lot of permanent weight — every build,
 * every upgrade — bought for one animation.
 *
 * The tumble ends on a chosen face rather than reading a value off wherever it
 * stopped. The value is decided before anything moves (see `diceDuel.ts`), so
 * reduced motion shows the same result without a second implementation.
 *
 * Opposite faces sum to seven, like a real die: 1–6, 2–5, 3–4. It is the sort of
 * thing nobody checks and everybody notices.
 */

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/theme/colors';

/** Pip positions in a 3×3 grid of thirds. Classic, and it has to be. */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  6: [
    [0.28, 0.24],
    [0.72, 0.24],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.76],
    [0.72, 0.76],
  ],
};

/** Ivory, not white: on a stout ground a pure white face glares. */
const FACE_TOP = '#FBF6EA';
const FACE_BOTTOM = '#E4DAC6';

/**
 * Where each value sits on the cube, and the rotation that brings it to front.
 *
 * Front 1, back 6, right 3, left 4, top 2, bottom 5 — every pair sums to seven.
 */
type FaceTransform = NonNullable<ViewStyle['transform']>;

const FACES: { value: number; transform: (half: number) => FaceTransform }[] = [
  // Front and back: rotate the frame, step along its X, rotate back.
  { value: 1, transform: (h) => [{ rotateY: '90deg' }, { translateX: -h }, { rotateY: '-90deg' }] },
  { value: 6, transform: (h) => [{ rotateY: '90deg' }, { translateX: h }, { rotateY: '90deg' }] },
  { value: 3, transform: (h) => [{ translateX: h }, { rotateY: '90deg' }] },
  { value: 4, transform: (h) => [{ translateX: -h }, { rotateY: '-90deg' }] },
  { value: 2, transform: (h) => [{ translateY: -h }, { rotateX: '90deg' }] },
  { value: 5, transform: (h) => [{ translateY: h }, { rotateX: '-90deg' }] },
];

/** The resting rotation that shows `value` face-on. */
const REST: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  6: { x: 0, y: 180 },
  3: { x: 0, y: -90 },
  4: { x: 0, y: 90 },
  2: { x: -90, y: 0 },
  5: { x: 90, y: 0 },
};

export function Die3D({
  value,
  size = 92,
  /** Bump to throw again — the same number twice still tumbles. */
  nonce = 0,
  rolling = false,
  /** Slightly different spin per die, so two thrown together are not twins. */
  offset = 0,
  duration = 850,
}: {
  value: number;
  size?: number;
  nonce?: number;
  rolling?: boolean;
  offset?: number;
  duration?: number;
}) {
  const half = size / 2;
  const rotX = useSharedValue(REST[value]?.x ?? 0);
  const rotY = useSharedValue(REST[value]?.y ?? 0);

  React.useEffect(() => {
    const rest = REST[value] ?? { x: 0, y: 0 };
    if (!rolling) {
      // Land: several whole turns past where it is, ending face-on. Going the
      // long way round is what makes it read as a throw rather than a flip.
      rotX.value = withTiming(rest.x + 360 * (2 + offset), {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      rotY.value = withTiming(rest.y + 360 * (3 - offset), {
        duration,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [value, nonce, rolling, offset, duration, rotX, rotY]);

  const cubeStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: size * 6 },
      { rotateX: `${rotX.value}deg` },
      { rotateY: `${rotY.value}deg` },
    ],
  }));

  return (
    <View style={[styles.stage, { width: size, height: size }]}>
      <Animated.View style={[styles.cube, { width: size, height: size }, cubeStyle]}>
        {FACES.map((face) => (
          <View
            key={face.value}
            style={[
              styles.face,
              { width: size, height: size },
              { transform: face.transform(half) },
            ]}
          >
            <DieSide value={face.value} size={size} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

/** One side of the cube: an ivory tile with pips on it. */
function DieSide({ value, size }: { value: number; size: number }) {
  const id = `die-side-${value}-${size}`;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <LinearGradient id={id} x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor={FACE_TOP} />
          <Stop offset="1" stopColor={FACE_BOTTOM} />
        </LinearGradient>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={size}
        height={size}
        rx={size * 0.2}
        fill={`url(#${id})`}
        stroke={Colors.stout}
        strokeOpacity={0.12}
        strokeWidth={1}
      />
      {(PIPS[value] ?? []).map(([x, y], index) => (
        <Circle key={index} cx={x * size} cy={y * size} r={size * 0.082} fill={Colors.stout} />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
    // The shadow sits on the stage, not the cube: on the cube it would rotate
    // with it and swing around the die like a searchlight.
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  cube: { alignItems: 'center', justifyContent: 'center' },
  face: { position: 'absolute', backfaceVisibility: 'hidden' },
});
