import React, { memo, ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet, ViewStyle } from 'react-native';
import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
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
        style={({ pressed }) => [
          styles.base,
          { height, borderRadius: Radius.pill },
          isPrimary ? styles.primaryBg : styles.secondaryBg,
          pressed && styles.pressed,
        ]}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityRole="button"
      >
        {icon != null && <View style={styles.iconSlot}>{icon}</View>}
        <Text style={[styles.label, isPrimary ? styles.primaryText : styles.secondaryText]}>
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
    backgroundColor: 'transparent',
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
    color: Colors.foamMuted,
  },
  iconSlot: {
    marginRight: 4,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
