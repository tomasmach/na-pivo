/**
 * LiveDot — a small amber dot that breathes opacity 0.4 ↔ 1 to mark anything
 * happening *tonight* (live friend activity, my own active broadcast, the
 * "TEĎ NA PIVU" header). Amber is the only accent and it appears only where
 * "now" is, so this dot is the smallest unit of that rule.
 *
 * The perpetual loop is isolated in this memoized component so a pulsing dot
 * never re-renders the card it sits in. Motion is gated on the OS reduce-motion
 * setting (under reduce motion the loop fully STOPS and the dot rests at full
 * opacity), and the animation is cancelled on unmount. Purely decorative, so it
 * is hidden from assistive tech.
 */

import React, { memo, useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '@/theme/colors';
import { useReduceMotion } from '@/utils/useReduceMotion';

interface LiveDotProps {
  /** Diameter of the dot in points. Defaults to 8. */
  size?: number;
}

const PULSE_DURATION = 1000;

export const LiveDot = memo(function LiveDot({ size = 8 }: LiveDotProps) {
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      // Reduce motion: rest at full opacity, no loop.
      opacity.value = 1;
      return;
    }

    // Breathe 1 → 0.4 → 1 forever (reverse=true) until unmount.
    opacity.value = withRepeat(
      withTiming(0.4, {
        duration: PULSE_DURATION,
        easing: Easing.inOut(Easing.quad),
      }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(opacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return { opacity: opacity.value };
  });

  return (
    <Animated.View
      importantForAccessibility="no"
      accessibilityElementsHidden
      pointerEvents="none"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: Colors.amber,
        },
        animatedStyle,
      ]}
    />
  );
});

export default LiveDot;
