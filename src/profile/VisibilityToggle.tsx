/**
 * Public-profile visibility toggle row — a labelled switch reused by the
 * onboarding wizard (step 3) and the edit screen. Mirrors the Settings screen
 * Toggle visuals (amber on, stout3 off, spring-animated thumb) so the control
 * feels identical across the app.
 */

import React, { memo, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { EyeIcon, EyeOffIcon } from '@/components/shared/IconGlyph';

interface VisibilityToggleProps {
  value: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  accessibilityLabel: string;
}

export const VisibilityToggle = memo(function VisibilityToggle({
  value,
  onToggle,
  label,
  accessibilityLabel,
}: VisibilityToggleProps) {
  const offset = useSharedValue(value ? 24 : 2);

  const handlePress = useCallback(() => {
    const next = !value;
    onToggle(next);
    offset.value = withSpring(next ? 24 : 2, { mass: 0.6, damping: 14, stiffness: 200 });
  }, [value, onToggle, offset]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Pressable
      onPress={handlePress}
      style={styles.row}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
    >
      <View style={[styles.iconWell, value && styles.iconWellOn]}>
        {value ? (
          <EyeIcon size={18} color={Colors.amber} />
        ) : (
          <EyeOffIcon size={18} color={Colors.mutedText} />
        )}
      </View>
      <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.heading}>
        {label}
      </Text>
      <View style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}>
        <Animated.View style={[styles.toggleThumb, softDrop(), thumbStyle]} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
  },
  iconWell: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWellOn: {
    backgroundColor: withAlpha(Colors.amber, 0.16),
  },
  label: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 16,
    color: Colors.foam,
  },
  toggle: {
    width: 52,
    height: 30,
    borderRadius: Radius.pill,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: Colors.amber,
  },
  toggleOff: {
    backgroundColor: Colors.stout3,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foam,
  },
});
