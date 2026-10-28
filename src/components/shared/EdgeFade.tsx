/**
 * The ground colour fading over content that scrolls under fixed chrome, so a
 * row slips under the header or the bottom bar instead of being cut at its edge.
 * `solid` is the share of the height, from the chrome's side, that stays opaque.
 */

import React, { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/theme/colors';

const FADE_OPACITY = 0.94;

export function EdgeFade({
  edge,
  solid,
  style,
}: {
  edge: 'top' | 'bottom';
  solid: number;
  style?: StyleProp<ViewStyle>;
}) {
  const id = `edge-fade-${useId().replace(/:/g, '')}`;
  const stops =
    edge === 'top'
      ? [
          { offset: 0, opacity: FADE_OPACITY },
          { offset: solid, opacity: FADE_OPACITY },
          { offset: 1, opacity: 0 },
        ]
      : [
          { offset: 0, opacity: 0 },
          { offset: 1 - solid, opacity: FADE_OPACITY },
          { offset: 1, opacity: FADE_OPACITY },
        ];

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {stops.map((stop) => (
              <Stop key={stop.offset} offset={stop.offset} stopColor={Colors.stout} stopOpacity={stop.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
