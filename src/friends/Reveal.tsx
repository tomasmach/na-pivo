/**
 * Reveal — mount-driven staggered entrance wrapper for FriendsScreen sections.
 *
 * Each top-level section is wrapped in <Reveal index={n}> so the screen fills
 * top→bottom on open: translateY 10→0 + opacity 0→1, staggered by index * 55ms.
 * A quick eased timing (no spring) — the section lands, it doesn't float in.
 *
 * Deliberately mount-driven (a `progress` shared value animated from a useEffect)
 * rather than Reanimated `entering` layout animations: the dashboard re-renders
 * on every pull-to-refresh, and `entering` would re-fire the stagger each time.
 * Mount-driven runs exactly once, when the section first appears.
 *
 * Reduce-motion fully skips the animation — progress jumps to 1 instantly, so the
 * content lands at its final position with no transform/opacity tween.
 */

import React, { useEffect } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReduceMotion } from '@/utils/useReduceMotion';

const ENTER_MS = 220;
const STAGGER_MS = 55;
const TRAVEL = 10;

interface RevealProps {
  index: number;
  children: React.ReactNode;
}

function RevealBase({ index, children }: RevealProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      Math.max(0, index) * STAGGER_MS,
      withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }),
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [reduceMotion, index, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * TRAVEL }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

export const Reveal = React.memo(RevealBase);

export default Reveal;
