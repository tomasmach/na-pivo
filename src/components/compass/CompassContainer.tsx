/**
 * The compass: static dial, rotating needle, static hub on top.
 *
 * There used to be a radial amber halo bleeding 40 % of the dial's size in every
 * direction behind this. It is gone: a blurred glow on the background is the
 * design system's §14.3 antipattern, and the one glow on a screen belongs under
 * the primary button. What made the dial feel like an object was never the
 * halo — it is the card it now sits in (`stout2` + a foam hairline) and the
 * pale paper disc inside the dial itself.
 */

import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SharedValue } from 'react-native-reanimated';
import { CompassDial } from './CompassDial';
import { CompassArrow } from './CompassArrow';
import { CompassSize } from '@/theme/layout';
import { Colors } from '@/theme/colors';

interface CompassContainerProps {
  rotation: SharedValue<number>;
  size?: number;
}

export const CompassContainer = memo(function CompassContainer({
  rotation,
  size = CompassSize,
}: CompassContainerProps) {
  return (
    <View style={{ width: size, height: size }}>
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
