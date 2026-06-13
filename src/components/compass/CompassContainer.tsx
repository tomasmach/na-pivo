import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
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
          <Defs>
            {/* Brushed-brass dome: lit TL → engraved core → shadowed BR */}
            <LinearGradient id="hubBrass" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={Colors.amberLight} />
              <Stop offset="50%" stopColor={Colors.engrave} />
              <Stop offset="100%" stopColor={Colors.border} />
            </LinearGradient>
          </Defs>
          <Circle
            cx={CompassSize / 2}
            cy={CompassSize / 2}
            r={16}
            fill="url(#hubBrass)"
            stroke={Colors.border}
            strokeWidth={1}
          />
          <Circle cx={CompassSize / 2} cy={CompassSize / 2} r={9} fill={Colors.enamel} />
          <Circle cx={CompassSize / 2} cy={CompassSize / 2} r={4.5} fill={Colors.amberLight} />
          {/* Tiny specular glint, offset up-left, where the key light catches the dome */}
          <Circle
            cx={CompassSize / 2 - 1.4}
            cy={CompassSize / 2 - 1.4}
            r={1.5}
            fill={Colors.glint}
            opacity={0.9}
          />
        </Svg>
      </View>
    </View>
  );
});
