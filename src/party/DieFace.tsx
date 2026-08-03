/**
 * A die that looks like a die.
 *
 * The first pass drew the number on an amber square, which is a score, not a
 * die — the whole appeal of rolling is that you recognise the face before you
 * count it, and nobody has ever recognised "4" as a die. So: pips, in the
 * arrangement everyone already knows, on an ivory face.
 *
 * The dimension is fake and cheap on purpose. A real 3D die means a renderer,
 * a mesh and a physics step for two cubes that land in under a second; this is
 * a rounded square with a light source top-left, a darker bottom edge standing
 * in for the extrusion, and a shadow under it. At the size a phone shows it, on
 * a table, that reads as an object — which is all it has to do.
 *
 * Drawn with `react-native-svg`, already a dependency (the covers and the route
 * map use it). No new package for two cubes.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

/** Where the pips sit, in a 3×3 grid of thirds. Classic, and it has to be. */
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
const FACE_BOTTOM = '#DCD1BC';
/** The extruded edge you can just see under the face. */
const EDGE = '#B6A98F';

export function DieFace({
  value,
  size = 92,
  /** Mid-roll: the face is blank and dimmed, so the landing reads as a landing. */
  blank = false,
}: {
  value: number;
  size?: number;
  blank?: boolean;
}) {
  const radius = size * 0.22;
  const pipRadius = size * 0.082;
  const pips = PIPS[value] ?? [];
  const id = `die-${size}-${value}-${blank ? 'b' : 'f'}`;

  return (
    <View style={[styles.shadow, { width: size, height: size + size * 0.06 }]}>
      <Svg width={size} height={size + size * 0.06}>
        <Defs>
          <LinearGradient id={id} x1="0.1" y1="0" x2="0.9" y2="1">
            <Stop offset="0" stopColor={FACE_TOP} />
            <Stop offset="1" stopColor={FACE_BOTTOM} />
          </LinearGradient>
        </Defs>

        {/* The edge, peeking out below — the whole trick of the depth. */}
        <Rect
          x={0}
          y={size * 0.06}
          width={size}
          height={size}
          rx={radius}
          fill={EDGE}
          opacity={blank ? 0.4 : 1}
        />
        <Rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={radius}
          fill={`url(#${id})`}
          opacity={blank ? 0.45 : 1}
        />

        {blank
          ? null
          : pips.map(([x, y], index) => (
              <Circle
                key={index}
                cx={x * size}
                cy={y * size}
                r={pipRadius}
                fill={Colors.stout}
              />
            ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    // Android has no shadow on an SVG; the drawn edge carries the depth there.
    elevation: 6,
    backgroundColor: withAlpha(Colors.stout, 0),
  },
});
