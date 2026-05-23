import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '@/theme/colors';

interface ConfettiStaticProps {
  width: number;
  height: number;
  pieceCount?: number;
}

const PALETTE = [
  Colors.foam,
  Colors.foamMuted,
  Colors.amber,
  Colors.amberLight,
  Colors.glow,
  Colors.neon,
];

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

interface Piece {
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius: number;
  color: string;
  rotate: number;
  opacity: number;
}

function buildPieces(width: number, height: number, count: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const shapeRoll = seededRandom(i * 3);
    const isPill = shapeRoll > 0.55;
    const isDot = shapeRoll < 0.25;
    const w = isPill ? 14 + seededRandom(i * 5) * 10 : 6 + seededRandom(i * 5) * 6;
    const h = isPill ? 5 + seededRandom(i * 7) * 3 : isDot ? w : w;
    pieces.push({
      x: seededRandom(i * 11) * width,
      y: 60 + seededRandom(i * 13) * (height - 200),
      width: w,
      height: h,
      borderRadius: isPill ? h / 2 : w / 2,
      color: PALETTE[Math.floor(seededRandom(i * 17) * PALETTE.length)],
      rotate: seededRandom(i * 19) * 360,
      opacity: 0.7 + seededRandom(i * 23) * 0.3,
    });
  }
  return pieces;
}

/**
 * Static scattered confetti, matching the celebration design.
 * No animation — pieces persist as decoration.
 */
export const ConfettiStatic = memo(function ConfettiStatic({
  width,
  height,
  pieceCount = 38,
}: ConfettiStaticProps) {
  const pieces = useMemo(
    () => buildPieces(width, height, pieceCount),
    [width, height, pieceCount],
  );

  return (
    <View
      style={[styles.container, { width, height }]}
      pointerEvents="none"
    >
      {pieces.map((p, i) => (
        <View
          key={i}
          style={[
            styles.piece,
            {
              left: p.x,
              top: p.y,
              width: p.width,
              height: p.height,
              borderRadius: p.borderRadius,
              backgroundColor: p.color,
              opacity: p.opacity,
              transform: [{ rotate: `${p.rotate}deg` }],
            },
          ]}
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
  piece: {
    position: 'absolute',
  },
});
