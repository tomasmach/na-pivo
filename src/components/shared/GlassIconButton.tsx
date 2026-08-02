/**
 * DESIGN MOCK — a floating glass button for a native header's trailing slot.
 *
 * iOS 26's own `headerSearchBarOptions` puts a full-width search FIELD at the
 * bottom of the screen, which is a different control for a different job. What
 * the pub list wants is the trailing action next to a large title: a circular
 * button, floating, on glass.
 *
 * Glass where the OS has it (§15.1), the solid fallback where it does not
 * (§15.2) — the same contract the tab bar and the live-party strip use.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { Colors, withAlpha } from '@/theme/colors';

const GLASS = isLiquidGlassAvailable();
const SIZE = 38;

export function GlassIconButton({
  children,
  onPress,
  accessibilityLabel,
  size = SIZE,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  /** Header trailing actions are 38; controls floating on a map are 44. */
  size?: number;
}) {
  const radius = size / 2;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: radius },
        // Only the fallback dims. Interactive glass supplies its own press
        // feedback, and dimming on top of it reads as two things happening.
        !GLASS && pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      {GLASS ? (
        // The jelly: iOS 26 deforms interactive glass under a press — but only
        // for touches the effect view itself receives. `pointerEvents="none"`
        // sets `userInteractionEnabled = NO` on it, which is exactly the touch
        // the deformation needs, so the button rendered as a frosted disc that
        // never moved. The glass stays touchable and the CONTENT goes
        // `pointerEvents="none"` instead, so a press on the glyph falls through
        // to the glass underneath it.
        //
        // The radius also lives here rather than as `overflow: 'hidden'` on the
        // parent: clipping the effect view would cut the deformation off at the
        // circle it is supposed to bulge past.
        <GlassView
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          glassEffectStyle="regular"
          isInteractive
          colorScheme="dark"
        />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, styles.solid, { borderRadius: radius }]}
          pointerEvents="none"
        />
      )}
      <View style={styles.content} pointerEvents="none">
        {children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { alignItems: 'center', justifyContent: 'center' },
  solid: {
    backgroundColor: withAlpha(Colors.stout3, 0.9),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.16),
  },
  pressed: { opacity: 0.7 },
});

/**
 * The same glass, as a labelled pill.
 *
 * A bare glyph floating on a map is a guess — "list" could mean anything. Two
 * words cost a few points of width and remove the guess, and the control still
 * floats.
 */
export function GlassPill({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pillStyles.pill, !GLASS && pressed && pillStyles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      {GLASS ? (
        <GlassView
          style={[StyleSheet.absoluteFill, pillStyles.round]}
          glassEffectStyle="regular"
          isInteractive
          colorScheme="dark"
        />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, pillStyles.round, pillStyles.solid]}
          pointerEvents="none"
        />
      )}
      <View style={pillStyles.content} pointerEvents="none">
        {children}
      </View>
    </Pressable>
  );
}

const RADIUS = 22;

const pillStyles = StyleSheet.create({
  pill: { height: 44, paddingHorizontal: 16, justifyContent: 'center' },
  round: { borderRadius: RADIUS },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  solid: {
    backgroundColor: withAlpha(Colors.stout3, 0.9),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.16),
  },
  pressed: { opacity: 0.7 },
});
