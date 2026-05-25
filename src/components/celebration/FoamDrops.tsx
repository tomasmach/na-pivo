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
  interpolate,
} from 'react-native-reanimated';
import { Colors } from '@/theme/colors';

export interface DropAnchor {
  x: number;
  y: number;
}

interface FoamDropsProps {
  width: number;
  /** Distance from the foam edge to the bottom of the fall path. */
  fallDistance: number;
  /** Anchor points where drops originate. Drops cycle through these. */
  anchors: ReadonlyArray<DropAnchor>;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

interface DropConfig {
  x: number;
  y: number;
  fallDuration: number;
  hangDuration: number;
  pauseDuration: number;
  startDelay: number;
  finalScale: number;
}

function buildDrops(anchors: ReadonlyArray<DropAnchor>): DropConfig[] {
  return anchors.map((anchor, i) => ({
    x: anchor.x,
    y: anchor.y,
    fallDuration: 900 + seededRandom(i * 73) * 800,
    hangDuration: 700 + seededRandom(i * 79) * 800,
    pauseDuration: 3500 + seededRandom(i * 83) * 4500,
    startDelay: seededRandom(i * 89) * 5500,
    finalScale: 0.8 + seededRandom(i * 97) * 0.6,
  }));
}

interface DropProps {
  config: DropConfig;
  fallDistance: number;
  reducedMotion: boolean;
}

const Drop = memo(function Drop({
  config,
  fallDistance,
  reducedMotion,
}: DropProps) {
  // progress 0 → 1 = hanging (grows), 1 → 2 = falling, 2 → 3 = pause hidden
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      progress.value = 0;
      return;
    }

    const cycle = withSequence(
      // Hang at the edge: bubble swells underneath the foam.
      withTiming(1, {
        duration: config.hangDuration,
        easing: Easing.out(Easing.quad),
      }),
      // Drop falls.
      withTiming(2, {
        duration: config.fallDuration,
        easing: Easing.in(Easing.quad),
      }),
      // Off-screen pause before respawning.
      withTiming(3, { duration: config.pauseDuration, easing: Easing.linear }),
      // Snap back to 0 to start the next cycle.
      withTiming(0, { duration: 1 }),
    );

    progress.value = withDelay(config.startDelay, withRepeat(cycle, -1, false));

    return () => {
      cancelAnimation(progress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    const p = progress.value;

    // Hang phase (0 → 1): drop bulges out from the foam edge.
    //   - starts inside the foam (translateY = -10, scale near zero)
    //   - swells outward, dropping its center to just below the foam
    // Fall phase (1 → 2): drop translates downward, stretching slightly.
    // Hidden phase (2+): invisible.
    const hangScale = interpolate(p, [0, 0.6, 1], [0, 0.9, 1]);
    const hangTranslate = interpolate(p, [0, 1], [-10, 4]);
    const fallProgress = Math.max(0, Math.min(1, p - 1));
    const translateY = hangTranslate + fallProgress * fallDistance;
    const stretchY = 1 + fallProgress * config.finalScale;
    const opacity =
      p < 1
        ? interpolate(p, [0, 0.3, 1], [0, 0.8, 1])
        : p < 2
          ? interpolate(p, [1, 1.8, 2], [1, 0.95, 0])
          : 0;

    return {
      opacity,
      transform: [
        { translateY },
        { scaleX: hangScale * (1 - fallProgress * 0.25) },
        { scaleY: hangScale * stretchY },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.drop,
        {
          left: config.x - 6,
          top: config.y - 6,
        },
        animatedStyle,
      ]}
      pointerEvents="none"
    >
      <View style={styles.dropBody} />
      <View style={styles.dropHighlight} />
    </Animated.View>
  );
});

export const FoamDrops = memo(function FoamDrops({
  width,
  fallDistance,
  anchors,
}: FoamDropsProps) {
  const reducedMotion = useReducedMotion();
  const drops = buildDrops(anchors);

  if (reducedMotion) return null;

  return (
    <View style={[styles.container, { width }]} pointerEvents="none">
      {drops.map((config, i) => (
        <Drop
          key={i}
          config={config}
          fallDistance={fallDistance}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  drop: {
    position: 'absolute',
    width: 12,
    height: 12,
  },
  dropBody: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.foam,
  },
  dropHighlight: {
    position: 'absolute',
    top: 2,
    left: 3,
    width: 4,
    height: 2,
    borderRadius: 1,
    backgroundColor: Colors.white,
    opacity: 0.7,
  },
});
