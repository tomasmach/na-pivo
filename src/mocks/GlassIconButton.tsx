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
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      {GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          // The jelly: iOS 26 deforms interactive glass under a press. Without
          // it a glass button is just a frosted rectangle.
          isInteractive
          colorScheme="dark"
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.solid]} pointerEvents="none" />
      )}
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.16),
  },
  solid: { backgroundColor: withAlpha(Colors.stout3, 0.9) },
  pressed: { opacity: 0.7 },
});
