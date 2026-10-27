/**
 * ScalePressable — the app's press affordance (DESIGN.md §6.2, §10): the
 * pressable sinks to `pressScale` at once on press-in and springs back on
 * release (transform only, GPU-composited). Under reduce-motion the scale is
 * skipped entirely and it falls back to a plain opacity dim.
 *
 * The Pressable itself is animated, so layout styles (flex, width, margins)
 * work exactly as on a plain Pressable. An opacity in `style` (e.g. a disabled
 * look) stays the resting opacity; the animated opacity would otherwise
 * override it.
 *
 * The shared values are written ONLY inside the effect (the CheersPill /
 * GoingRoster idiom the React Compiler accepts); the press handlers just flip
 * plain React state. onPress never waits for the animation.
 */

import React, { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/utils/useReduceMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const PressScale = {
  /** Cards, photo tiles, secondary pills and round buttons. */
  default: 0.97,
  /** The amber primary button: a deeper press for the one main action. */
  primary: 0.955,
  /** Full-width rows: barely, so the screen edge does not jump. */
  row: 0.985,
} as const;

const PRESS_IN = { duration: 70, easing: Easing.out(Easing.quad) };
const RELEASE_SPRING = { damping: 20, stiffness: 320, mass: 0.6 };
const REDUCED_DIM = 0.7;

export interface ScalePressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  pressScale?: number;
  children?: React.ReactNode;
}

export function ScalePressable({
  style,
  pressScale = PressScale.default,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: ScalePressableProps) {
  const reduceMotion = useReduceMotion();
  const [pressed, setPressed] = useState(false);
  const flatOpacity = StyleSheet.flatten(style)?.opacity;
  const restOpacity = typeof flatOpacity === 'number' ? flatOpacity : 1;

  const scale = useSharedValue(1);
  const opacity = useSharedValue(restOpacity);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
      opacity.value = withTiming(pressed ? restOpacity * REDUCED_DIM : restOpacity, {
        duration: pressed ? 80 : 120,
      });
      return;
    }
    opacity.value = restOpacity;
    scale.value = pressed ? withTiming(pressScale, PRESS_IN) : withSpring(1, RELEASE_SPRING);
  }, [pressed, reduceMotion, pressScale, restOpacity, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
