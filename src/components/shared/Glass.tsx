/**
 * The floating-control material (DESIGN.md §15): system liquid glass where iOS
 * draws it, otherwise the plain surface the control had before.
 */

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { Colors } from '@/theme/colors';

const glassAvailable = isLiquidGlassAvailable();

export function GlassSurface({
  style,
  fallbackColor = Colors.stout2,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  fallbackColor?: string;
  children?: React.ReactNode;
}) {
  if (glassAvailable) {
    return (
      <GlassView style={style} glassEffectStyle="regular" isInteractive>
        {children}
      </GlassView>
    );
  }
  return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
}
