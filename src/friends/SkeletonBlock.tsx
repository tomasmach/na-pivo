/**
 * SkeletonBlock — the single shimmer primitive behind FriendsSkeleton (spec §11).
 *
 * A dim foam-wash rectangle that breathes its opacity between 0.5 and 0.9 on a
 * 900 ms ping-pong. Under reduce-motion the loop fully STOPS and the block rests
 * at a static 0.7 (never a slowed loop). Purely decorative, so it is hidden from
 * the accessibility tree.
 */

import React, { memo, useEffect } from 'react';
import type { DimensionValue } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';
import { Radius } from '@/theme/layout';

type SkeletonBlockProps = {
  width: DimensionValue;
  height: DimensionValue;
  radius?: number;
  reduceMotion: boolean;
};

const SHIMMER_MS = 900;
const SHIMMER_LOW = 0.5;
const SHIMMER_HIGH = 0.9;
const STATIC_OPACITY = 0.7;
const BLOCK_BG = withAlpha(Colors.foam, 0.06);

function SkeletonBlockComponent({
  width,
  height,
  radius = Radius.medium,
  reduceMotion,
}: SkeletonBlockProps) {
  const opacity = useSharedValue(reduceMotion ? STATIC_OPACITY : SHIMMER_LOW);

  useEffect(() => {
    if (reduceMotion) {
      // Reduce-motion: stop the loop entirely and rest at a calm static value.
      cancelAnimation(opacity);
      opacity.value = STATIC_OPACITY;
      return;
    }

    // 0.5 ↔ 0.9 ping-pong; reverse:true gives the symmetric breathe.
    opacity.value = SHIMMER_LOW;
    opacity.value = withRepeat(
      withTiming(SHIMMER_HIGH, { duration: SHIMMER_MS }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(opacity);
    };
  }, [reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: BLOCK_BG,
        },
        animatedStyle,
      ]}
    />
  );
}

export default memo(SkeletonBlockComponent);
