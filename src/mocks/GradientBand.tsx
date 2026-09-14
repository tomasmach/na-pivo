/**
 * DESIGN MOCK — the header shader.
 *
 * Packeta puts a soft pink glow at the very top of Home that fades into the
 * background; this is the brown one, and the green one while a session runs.
 *
 * Built on `react-native-svg` (already a dependency — `CardSurface.tsx` draws
 * its sheen exactly this way) rather than `expo-linear-gradient`, which is not
 * installed and would cost a native rebuild mid-review.
 *
 * It is absolutely positioned behind the content and never animates: per
 * design-system §16.2 this is light on the chrome, not an ambient halo, and
 * §10 still forbids anything that moves on its own.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/** How far down the screen the glow is still doing anything. */
const BAND_HEIGHT = 320;

export function GradientBand({ stops }: { stops: readonly [string, string, string] }) {
  return (
    <View style={styles.band} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="band" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={stops[0]} stopOpacity="1" />
            <Stop offset="0.45" stopColor={stops[1]} stopOpacity="1" />
            <Stop offset="1" stopColor={stops[2]} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#band)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BAND_HEIGHT,
  },
});
