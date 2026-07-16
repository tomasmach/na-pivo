import React, { memo, ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { amberGlow, amberGlowStrong } from '@/theme/shadows';

export type GlowButtonVariant = 'primary' | 'secondary';
export type GlowButtonGlow = 'soft' | 'strong' | 'none';

export interface GlowButtonProps {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  variant?: GlowButtonVariant;
  glow?: GlowButtonGlow;
  height?: number;
  accessibilityLabel?: string;
  loading?: boolean;
  disabled?: boolean;
}

function resolveGlowStyle(glow: GlowButtonGlow): ViewStyle {
  if (glow === 'soft') return amberGlow(18);
  if (glow === 'strong') return amberGlowStrong(32);
  return {};
}

export const GlowButton = memo(function GlowButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  glow = 'soft',
  height = 62,
  accessibilityLabel,
  loading = false,
  disabled = false,
}: GlowButtonProps) {
  const isPrimary = variant === 'primary';
  const glowStyle = resolveGlowStyle(glow);

  return (
    <View style={[styles.wrapper, { height }]}>
      {/* Glow layer underneath */}
      {glow !== 'none' && isPrimary && (
        <View
          style={[
            styles.glowLayer,
            { height, borderRadius: Radius.pill },
            glowStyle,
          ]}
        />
      )}
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.base,
          { height, borderRadius: Radius.pill },
          isPrimary ? styles.primaryBg : styles.secondaryBg,
          pressed && styles.pressed,
          (disabled || loading) && styles.disabled,
        ]}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
      >
        {loading ? (
          <ActivityIndicator color={isPrimary ? Colors.stout : Colors.foam} size="small" />
        ) : icon != null ? (
          <View style={styles.iconSlot}>{icon}</View>
        ) : null}
        <Text
          style={[styles.label, isPrimary ? styles.primaryText : styles.secondaryText]}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  glowLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.amber,
    opacity: 0.35,
  },
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 8,
  },
  primaryBg: {
    backgroundColor: Colors.amber,
  },
  secondaryBg: {
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.36),
  },
  label: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    letterSpacing: 0.3,
  },
  primaryText: {
    color: Colors.stout,
  },
  secondaryText: {
    color: Colors.foam,
  },
  iconSlot: {
    marginRight: 4,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.7,
  },
});
