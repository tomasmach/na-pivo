/**
 * ScalePressable — the tactile press affordance for photo tiles and vote pills:
 * the whole tile springs to ~0.97 on press-in and back on release (transform
 * only, GPU-composited). Under reduce-motion the scale is skipped entirely and
 * the tile falls back to a plain opacity dim.
 *
 * The shared values are written ONLY inside the effect (the CheersPill /
 * GoingRoster idiom the React Compiler accepts); the press handlers just flip
 * plain React state.
 *
 * A thin wrapper over RN Pressable, so every accessibility prop passes through.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/utils/useReduceMotion';

const PRESS_SCALE = 0.97;

interface ScalePressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function ScalePressable({
  style,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: ScalePressableProps) {
  const reduceMotion = useReduceMotion();
  const [pressed, setPressed] = useState(false);

  const scale = useSharedValue(1);
  const dim = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      scale.value = 1;
      dim.value = withTiming(pressed ? 0.7 : 1, { duration: pressed ? 80 : 120 });
      return;
    }
    dim.value = 1;
    scale.value = withSpring(pressed ? PRESS_SCALE : 1, {
      damping: 20,
      stiffness: 320,
      mass: 0.6,
    });
  }, [pressed, reduceMotion, scale, dim]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: dim.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      {...rest}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
