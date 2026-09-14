/**
 * LiveDot — a small static amber dot marking anything
 * happening *tonight* (live friend activity, my own active broadcast, the
 * "TEĎ NA PIVU" header). Amber is the only accent and it appears only where
 * "now" is, so this dot is the smallest unit of that rule.
 *
 * The perpetual loop is isolated in this memoized component so a pulsing dot
 * never re-renders the card it sits in. Motion is gated on the OS reduce-motion
 * setting (under reduce motion the loop fully STOPS and the dot rests at full
 * opacity), and the animation is cancelled on unmount. Purely decorative, so it
 * is hidden from assistive tech.
 */

import React, { memo } from 'react';
import { View } from 'react-native';
import { Colors } from '@/theme/colors';

interface LiveDotProps {
  /** Diameter of the dot in points. Defaults to 8. */
  size?: number;
  /**
   * Stale-data cue (§2C): while the dashboard failed to refresh, "live" must not
   * lie — the dot stops breathing and rests dim at a static 0.4.
   */
  stale?: boolean;
}

const STALE_OPACITY = 0.4;

export const LiveDot = memo(function LiveDot({ size = 8, stale = false }: LiveDotProps) {
  return (
    <View
      importantForAccessibility="no"
      accessibilityElementsHidden
      pointerEvents="none"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: Colors.amber,
          opacity: stale ? STALE_OPACITY : 1,
        },
      ]}
    />
  );
});

export default LiveDot;
