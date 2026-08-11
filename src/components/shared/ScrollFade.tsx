/**
 * ScrollFade — the edge between a scrolling list and the fixed footer under it.
 *
 * On a screen whose bottom is a fixed action footer (NudgeSlot + CounterCta +
 * CounterSecondary), the ScrollView clips its last row mid-height, so the amber
 * button ends up sitting on a guillotined card. This is a short stout gradient,
 * pinned above the footer, that lets the content dissolve into the background
 * instead. Purely decorative: absolute, `pointerEvents="none"`, no layout cost.
 *
 * It is NOT a full-screen gradient (see the anti-pattern list in
 * DESIGN.md) — it is 28pt of the page's own background colour.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/theme/colors';

const FADE_HEIGHT = 28;

/**
 * @param height Shorter fade for feeds, where 28pt of dissolve eats a readable
 * line of the last row. Only go below the default when the footer under it is
 * small enough that the cut edge is barely visible anyway.
 */
export function ScrollFade({ height = FADE_HEIGHT }: { height?: number } = {}) {
  return (
    <View style={[styles.fade, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="scrollFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={Colors.stout} stopOpacity={0} />
            <Stop offset="1" stopColor={Colors.stout} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#scrollFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    // Bleeds past the screen padding so the fade covers the full width. It sits
    // INSIDE the scrolling area's own bounds on purpose: an absolute child that
    // overflows its parent is clipped on Android.
    left: -24,
    right: -24,
    bottom: 0,
  },
});
