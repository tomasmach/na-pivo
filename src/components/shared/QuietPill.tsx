/**
 * The secondary action, DESIGN §6.2: a quiet `stout3` pill, never an outline.
 *
 * `CounterSecondary` is the 2.x amber 6% outline and stays where it already
 * ships; new and corrected secondary buttons use this. Same shape the privacy
 * screen and the Komunita "create" row already draw by hand.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export const QuietPill = memo(function QuietPill({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.pill, pressed && !disabled && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pill: {
    minHeight: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  pressed: { opacity: 0.65 },
  label: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.foam,
    includeFontPadding: false,
  },
});
