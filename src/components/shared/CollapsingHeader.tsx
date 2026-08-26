/**
 * The bar that forms under floating header buttons once the title scrolls away.
 *
 * Screens that own their heading as CONTENT (the feed wordmark, a challenge
 * title) have no native bar to hide behind, so their trailing buttons floated
 * on nothing: scrolled post text and status-bar time ran straight under them.
 * The native large-title screens (Komunita, Profil) get the same job done by
 * iOS — they only needed an opaque `headerStyle` — so this is deliberately the
 * same *behaviour*, not a second header system: big title in the content, and
 * once you scroll past it a bar re-forms with the small title on it.
 *
 * Material follows §15: glass where iOS has it, the mandatory opaque `stout`
 * fallback everywhere else (§15.2). The bar sits UNDER the buttons, so a
 * transparent-header native back control keeps working on top of it.
 */

import React, { useMemo, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { MockLayout } from '@/mocks/mockTheme';
import { Spacing } from '@/theme/layout';

const GLASS = isLiquidGlassAvailable();

/** Height of the bar below the safe-area inset — one row of 40pt controls. */
export const COLLAPSING_BAR_HEIGHT = 52;

/**
 * Scroll plumbing for a screen that hosts {@link CollapsingHeader}.
 *
 * `threshold` is the offset at which the content title has left the bar. The
 * bar fades in over the last 24pt before it, so the swap reads as one motion
 * rather than a flash (§10: the movement follows the finger).
 */
export function barFadeRange(threshold: number): [number, number] {
  const from = Math.max(0, threshold - 24);
  return [from, Math.max(from + 1, threshold)];
}

export function useCollapsingHeader(threshold: number) {
  // `useState` rather than a ref: the value is read during render (the
  // interpolation is part of the returned style), which the refs lint rule
  // rightly forbids for refs. The lazy initialiser keeps it to one instance.
  const [scrollY] = useState(() => new Animated.Value(0));

  return useMemo(() => {
    return {
      progress: scrollY.interpolate({
        inputRange: barFadeRange(threshold),
        outputRange: [0, 1],
        extrapolate: 'clamp' as const,
      }),
      scrollProps: {
        onScroll: Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        }),
        scrollEventThrottle: 16,
      },
    };
  }, [scrollY, threshold]);
}

export function CollapsingHeader({
  progress,
  title,
  children,
}: {
  /** 0 = title still in the content, 1 = bar fully formed. */
  progress: Animated.AnimatedInterpolation<number>;
  title: string;
  /** Trailing controls. They stay visible the whole time; only the bar fades. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.wrap, { height: insets.top + COLLAPSING_BAR_HEIGHT }]}
      pointerEvents="box-none"
    >
      {/* The material. `pointerEvents="none"` so taps reach the list behind the
          bar while it is still transparent. */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: progress }]} pointerEvents="none">
        {GLASS ? (
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            colorScheme="dark"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.solid]} />
        )}
        <View style={styles.hairline} />
      </Animated.View>

      {/* Centred title with the actions floating over it, so the small title
          lands where the native bars put theirs (Komunita, Profil) instead of
          inventing a second header layout. */}
      <View style={[styles.row, { paddingTop: insets.top }]} pointerEvents="box-none">
        <Animated.Text
          style={[styles.title, { opacity: progress }]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {title}
        </Animated.Text>
        {children ? <View style={styles.actions}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 },
  solid: { backgroundColor: Colors.stout },
  hairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  row: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: MockLayout.screenPad,
  },
  // Kept clear of both edges so a long title truncates rather than running into
  // the back control or the trailing buttons (§13.8).
  title: {
    marginHorizontal: 56,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foam,
  },
  actions: {
    position: 'absolute',
    right: MockLayout.screenPad,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
