/**
 * LevelRing — the career, read plainly: which rung you are on, how far into it.
 *
 * It replaced a drawn stack of beer mats. The stack looked like a pile of
 * pancakes, and worse, it encoded the ladder twice: once as an unreadable
 * height and once as the sentence in the footer. A ring shows the one thing the
 * sentence cannot — how much of this level is already behind you — and it shows
 * the level number itself, which is what people actually talk about.
 *
 * Design rules this file enforces:
 * - Vector, colours from tokens only.
 * - The arc is amber as a THIN stroke, never a filled amber plane: the screen's
 *   one full amber surface belongs to its one button, and its one big amber
 *   numeral is the lifetime count. The level numeral is therefore foam.
 * - No glow, and nothing animates. The arc reacts to data, not to time, and an
 *   arc that grows on mount would be motion on mount (§10).
 * - No account yet means no level: the ring stays an empty track with a keyhole
 *   in it, so it promises the ladder without inventing a rung.
 */

import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { LockKeyholeIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';

const STROKE = 6;
/** Below a full turn the arc needs a visible start, so it never reads as empty. */
const MIN_ARC = 0.04;

export interface LevelRingProps {
  /** Rung number, or null when there is no account and so no level. */
  level: number | null;
  /** The rung's name ("Výčepní"), uppercased here. Null draws no caption. */
  title: string | null;
  /** 0..1 through the current rung. Null (or a maxed level) draws a full ring. */
  progress: number | null;
  /** Outer diameter in points; the parent sizes it from the card. */
  size?: number;
}

export const LevelRing = memo(function LevelRing({
  level,
  title,
  progress,
  size = 92,
}: LevelRingProps) {
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const filled =
    level === null
      ? 0
      : progress === null
        ? 1
        : Math.max(MIN_ARC, Math.min(1, Number.isFinite(progress) ? progress : 0));

  return (
    <View style={styles.wrap} accessibilityElementsHidden importantForAccessibility="no">
      <View>
        <Svg width={size} height={size}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={withAlpha(Colors.foam, 0.08)}
            strokeWidth={STROKE}
            fill="none"
          />
          {filled > 0 ? (
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={Colors.amber}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - filled)}
              // Start at 12 o'clock and sweep clockwise, like a pour.
              transform={`rotate(-90 ${center} ${center})`}
            />
          ) : null}
        </Svg>
        <View style={[styles.center, { width: size, height: size }]}>
          {level === null ? (
            // No account, no rung. A keyhole says "this opens" where a dash only
            // said "nothing" — and the screen's one button is exactly the key.
            <LockKeyholeIcon size={Math.round(size * 0.26)} color={Colors.mutedText} />
          ) : (
            <Text
              style={[styles.level, { fontSize: Math.round(size * 0.34) }]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.display}
            >
              {level}
            </Text>
          )}
        </View>
      </View>

      {title !== null ? (
        <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {title.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 8,
    // Keeps a long rung name from pushing the lifetime numeral off the card.
    maxWidth: 132,
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  level: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  title: {
    fontFamily: Fonts.display.bold,
    fontSize: 11,
    letterSpacing: 1.6,
    color: Colors.foamMuted,
    includeFontPadding: false,
    textAlign: 'center',
  },
});
