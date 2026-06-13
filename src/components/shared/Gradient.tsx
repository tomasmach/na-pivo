import React, { memo, useId } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

/**
 * Gradient fill helpers for non-SVG surfaces.
 *
 * React Native `View`s cannot paint gradient backgrounds the way CSS can, and
 * the project deliberately avoids `expo-linear-gradient`. Instead these render
 * an absolutely-positioned `<Svg>` with a percentage-sized `<Rect>` filled by a
 * gradient — the same react-native-svg approach already used by `SoftGlow` and
 * `CompassContainer`. Drop one in as the FIRST child of a `position:'relative'`
 * container (give the container `overflow:'hidden'` + `borderRadius` to clip the
 * corners); subsequent children render above it.
 */

export interface GradientStop {
  /** 0–1 position along the gradient. */
  offset: number;
  color: string;
  /** 0–1 alpha; defaults to 1. */
  opacity?: number;
}

interface LinearBackdropProps {
  stops: GradientStop[];
  /** Vertical (top→bottom) by default; horizontal when false. */
  vertical?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const LinearBackdrop = memo(function LinearBackdrop({
  stops,
  vertical = true,
  style,
}: LinearBackdropProps) {
  const id = `lin-${useId()}`;
  return (
    <Svg
      style={[StyleSheet.absoluteFill, style]}
      width="100%"
      height="100%"
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
          {stops.map((s, i) => (
            <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
});

interface RadialBackdropProps {
  stops: GradientStop[];
  /** Center + radius as SVG percentage strings. */
  cx?: string;
  cy?: string;
  r?: string;
  style?: StyleProp<ViewStyle>;
}

export const RadialBackdrop = memo(function RadialBackdrop({
  stops,
  cx = '50%',
  cy = '50%',
  r = '50%',
  style,
}: RadialBackdropProps) {
  const id = `rad-${useId()}`;
  return (
    <Svg
      style={[StyleSheet.absoluteFill, style]}
      width="100%"
      height="100%"
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id={id} cx={cx} cy={cy} r={r} fx={cx} fy={cy}>
          {stops.map((s, i) => (
            <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
          ))}
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
});
