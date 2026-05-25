import React, { memo, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  cancelAnimation,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '@/theme/colors';

interface BeerBubblesProps {
  width: number;
  height: number;
  bubbleCount?: number;
}

type BubbleKind = 'ring' | 'sparkle';

interface BubbleConfig {
  x: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  opacity: number;
  kind: BubbleKind;
  color: string;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function buildBubbles(width: number, count: number): BubbleConfig[] {
  return Array.from({ length: count }, (_, i) => {
    const kindRoll = seededRandom(i * 67);
    const isSparkle = kindRoll > 0.78;
    const isAmber = !isSparkle && kindRoll > 0.62;
    return {
      x: seededRandom(i * 31) * width,
      size: isSparkle
        ? 2 + seededRandom(i * 41) * 3
        : 5 + seededRandom(i * 41) * 12,
      duration: 4500 + seededRandom(i * 47) * 4000,
      delay: seededRandom(i * 53) * 6000,
      drift: (seededRandom(i * 59) - 0.5) * 60,
      opacity: isSparkle
        ? 0.5 + seededRandom(i * 61) * 0.4
        : 0.22 + seededRandom(i * 61) * 0.32,
      kind: isSparkle ? 'sparkle' : 'ring',
      color: isSparkle
        ? Colors.neon
        : isAmber
          ? Colors.amberLight
          : Colors.foam,
    };
  });
}

interface BubbleProps {
  config: BubbleConfig;
  travel: number;
  reducedMotion: boolean;
}

const Bubble = memo(function Bubble({ config, travel, reducedMotion }: BubbleProps) {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      translateY.value = -travel * 0.5;
      opacity.value = config.opacity * 0.4;
      return;
    }

    translateY.value = withDelay(
      config.delay,
      withRepeat(
        withTiming(-travel, {
          duration: config.duration,
          easing: Easing.out(Easing.quad),
        }),
        -1,
        false,
      ),
    );

    translateX.value = withDelay(
      config.delay,
      withRepeat(
        withTiming(config.drift, {
          duration: config.duration * 0.5,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      ),
    );

    opacity.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(config.opacity, { duration: config.duration * 0.22 }),
          withTiming(config.opacity, { duration: config.duration * 0.56 }),
          withTiming(0, { duration: config.duration * 0.22 }),
        ),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(translateY);
      cancelAnimation(translateX);
      cancelAnimation(opacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { translateX: translateX.value },
    ],
    opacity: opacity.value,
  }));

  const isSparkle = config.kind === 'sparkle';

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          left: config.x,
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: isSparkle ? config.color : 'transparent',
          borderWidth: isSparkle ? 0 : Math.max(1, config.size * 0.12),
          borderColor: config.color,
        },
        animatedStyle,
      ]}
    />
  );
});

export const BeerBubbles = memo(function BeerBubbles({
  width,
  height,
  bubbleCount = 28,
}: BeerBubblesProps) {
  const reducedMotion = useReducedMotion();
  const bubbles = buildBubbles(width, bubbleCount);

  return (
    <View style={[styles.container, { width, height }]} pointerEvents="none">
      {bubbles.map((config, i) => (
        <Bubble
          key={i}
          config={config}
          travel={height + 40}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  bubble: {
    position: 'absolute',
    bottom: -20,
  },
});
