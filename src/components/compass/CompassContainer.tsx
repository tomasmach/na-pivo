import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { SharedValue } from 'react-native-reanimated';
import { CompassDial } from './CompassDial';
import { CompassArrow } from './CompassArrow';
import { CompassSize } from '@/theme/layout';
import { Colors } from '@/theme/colors';

interface CompassContainerProps {
  rotation: SharedValue<number>;
  size?: number;
}

// Glow extends this fraction of `size` beyond the dial on each side.
const GLOW_OVERFLOW_RATIO = 0.4;

export const CompassContainer = memo(function CompassContainer({
  rotation,
  size = CompassSize,
}: CompassContainerProps) {
  const glowOverflow = size * GLOW_OVERFLOW_RATIO;
  const glowSize = size + glowOverflow * 2;

  return (
    <View style={{ width: size, height: size }}>
      {/* Outer glow halo — overflows container so it spreads beyond the dial */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -glowOverflow,
          left: -glowOverflow,
          width: glowSize,
          height: glowSize,
        }}
      >
        <Svg width={glowSize} height={glowSize} viewBox={`0 0 ${glowSize} ${glowSize}`}>
          <Defs>
            <RadialGradient id="compassGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0%" stopColor={Colors.glow} stopOpacity={0.55} />
              <Stop offset="35%" stopColor={Colors.glow} stopOpacity={0.32} />
              <Stop offset="70%" stopColor={Colors.glow} stopOpacity={0.08} />
              <Stop offset="100%" stopColor={Colors.glow} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={glowSize / 2} cy={glowSize / 2} r={glowSize / 2} fill="url(#compassGlow)" />
        </Svg>
      </View>

      {/* Static dial (rings, ticks, cardinals, hub) */}
      <CompassDial size={size} />

      {/* Rotating arrow layered on top */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <CompassArrow rotation={rotation} size={size} />
      </View>

      {/* Static hub layered above the arrow so needles disappear under it */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={size} height={size} viewBox={`0 0 ${CompassSize} ${CompassSize}`}>
          <Circle cx={CompassSize / 2} cy={CompassSize / 2} r={15} fill={Colors.stout} stroke={Colors.amber} strokeWidth={2} />
          <Circle cx={CompassSize / 2} cy={CompassSize / 2} r={7} fill={Colors.amber} />
        </Svg>
      </View>
    </View>
  );
});
