/**
 * The completeness ring shown in the "Zmapuj hospodu" sheet header (spec §3.4).
 * A circular SVG progress ring: a stout3 track + an amber arc with an amber glow
 * once >0, rounded caps, with the percentage in the centre and a caption below.
 *
 * The arc animates with withTiming, gated by reduce-motion (the arc is set
 * directly when the user asked to calm motion). It is a `progressbar` for
 * VoiceOver. The centre number caps its Dynamic Type scaling so it never
 * overflows the ring.
 */

import React, { memo, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { cs } from '@/i18n/cs';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface CompletenessRingProps {
  /** 0..1 community completeness. */
  pct: number;
  size?: number;
  reduceMotion: boolean;
}

const STROKE = 5;

export const CompletenessRing = memo(function CompletenessRing({
  pct,
  size = 56,
  reduceMotion,
}: CompletenessRingProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0));
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const percent = Math.round(clamped * 100);

  // Animate the dash offset from "empty" (full circumference) toward the target.
  const progress = useSharedValue(reduceMotion ? clamped : 0);
  useEffect(() => {
    progress.value = reduceMotion ? clamped : withTiming(clamped, { duration: 280 });
  }, [clamped, reduceMotion, progress]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={cs.mapPub.ringA11y(percent)}
      accessibilityValue={{ now: percent, min: 0, max: 100 }}
    >
      <View>
        <Svg width={size} height={size}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={Colors.stout3}
            strokeWidth={STROKE}
            fill="none"
          />
          <AnimatedCircle
            cx={center}
            cy={center}
            r={radius}
            stroke={Colors.amber}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animatedProps={arcProps}
            // Start the arc at 12 o'clock and sweep clockwise.
            transform={`rotate(-90 ${center} ${center})`}
          />
        </Svg>
        <View style={[styles.centerLabel, { width: size, height: size }]}>
          <Text
            style={styles.percent}
            maxFontSizeMultiplier={FontScaleCap.display}
            numberOfLines={1}
          >
            {`${percent}%`}
          </Text>
        </View>
      </View>
      <Text style={styles.caption} maxFontSizeMultiplier={FontScaleCap.body} numberOfLines={1}>
        {cs.mapPub.ringCaption}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  centerLabel: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  caption: {
    marginTop: 4,
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    color: Colors.mutedText,
  },
});
