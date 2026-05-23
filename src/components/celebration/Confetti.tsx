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

interface ConfettiProps {
  width: number;
  height: number;
  pieceCount?: number;
}

const COLORS = [
  Colors.amber,
  Colors.amberLight,
  Colors.neon,
  Colors.foam,
  Colors.glow,
];

// Seeded pseudo-random for consistent layout between renders
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

interface PieceConfig {
  x: number;
  delay: number;
  duration: number;
  color: string;
  width: number;
  height: number;
  isEllipse: boolean;
  rotateEnd: number;
}

function buildPieces(width: number, count: number): PieceConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    x: seededRandom(i * 7) * width,
    delay: seededRandom(i * 13) * 600,
    duration: 1600 + seededRandom(i * 17) * 800,
    color: COLORS[Math.floor(seededRandom(i * 3) * COLORS.length)],
    width: seededRandom(i * 5) > 0.5 ? 8 : 10,
    height: seededRandom(i * 11) > 0.5 ? 16 : 10,
    isEllipse: seededRandom(i * 19) > 0.5,
    rotateEnd: seededRandom(i * 23) > 0.5
      ? 360 + Math.floor(seededRandom(i * 29) * 360)
      : -(360 + Math.floor(seededRandom(i * 31) * 360)),
  }));
}

interface ConfettiPieceProps {
  config: PieceConfig;
  totalHeight: number;
  reducedMotion: boolean;
}

const ConfettiPiece = memo(function ConfettiPiece({
  config,
  totalHeight,
  reducedMotion,
}: ConfettiPieceProps) {
  const translateY = useSharedValue(-50);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      translateY.value = totalHeight / 2;
      opacity.value = 1;
      rotate.value = config.rotateEnd / 2;
      return;
    }

    translateY.value = withDelay(
      config.delay,
      withTiming(totalHeight + 50, {
        duration: config.duration,
        easing: Easing.linear,
      }),
    );

    rotate.value = withDelay(
      config.delay,
      withRepeat(
        withTiming(config.rotateEnd, {
          duration: config.duration,
          easing: Easing.linear,
        }),
        1,
        false,
      ),
    );

    opacity.value = withDelay(
      config.delay,
      withSequence(
        withTiming(1, { duration: config.duration * 0.65 }),
        withTiming(0, { duration: config.duration * 0.35 }),
      ),
    );

    return () => {
      cancelAnimation(translateY);
      cancelAnimation(rotate);
      cancelAnimation(opacity);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  const pieceStyle = config.isEllipse
    ? {
        width: config.width,
        height: config.height,
        borderRadius: config.width / 2,
        backgroundColor: config.color,
      }
    : {
        width: config.width,
        height: config.height,
        backgroundColor: config.color,
      };

  return (
    <Animated.View
      style={[
        styles.piece,
        { left: config.x, top: -50 },
        animatedStyle,
        pieceStyle,
      ]}
    />
  );
});

export const Confetti = memo(function Confetti({
  width,
  height,
  pieceCount = 30,
}: ConfettiProps) {
  const reducedMotion = useReducedMotion();
  const pieces = buildPieces(width, pieceCount);

  return (
    <View
      style={[styles.container, { width, height }]}
      pointerEvents="none"
    >
      {pieces.map((config, i) => (
        <ConfettiPiece
          key={i}
          config={config}
          totalHeight={height}
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
    overflow: 'hidden',
  },
  piece: {
    position: 'absolute',
  },
});
