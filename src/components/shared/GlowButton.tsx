import React, { memo, ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { amberGlow, amberGlowStrong } from '@/theme/shadows';

export type GlowButtonVariant = 'primary' | 'secondary';
export type GlowButtonGlow = 'soft' | 'strong' | 'none';

export interface GlowButtonProps {
  label: string;
  subLabel?: string | null;
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
  subLabel,
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
        <View style={styles.labelRow}>
          {loading ? (
            <ActivityIndicator color={isPrimary ? Colors.stout : Colors.foam} size="small" />
          ) : icon != null ? (
            <View style={styles.iconSlot}>{icon}</View>
          ) : null}
          {/* Shrink before truncating (§3.3): at the largest Dynamic Type sizes
              "Dopiš večer" came out as "Dopiš v…", which turns the one label
              that says what the tap does into a guess. */}
          <Text
            style={[styles.label, isPrimary ? styles.primaryText : styles.secondaryText]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {label}
          </Text>
        </View>
        {subLabel ? (
          <Text
            style={[
              styles.subLabel,
              isPrimary ? styles.primarySubText : styles.secondaryText,
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {subLabel}
          </Text>
        ) : null}
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
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
    fontWeight: '800',
    fontSize: 20,
    letterSpacing: 0.3,
  },
  primaryText: {
    color: Colors.stout,
  },
  secondaryText: {
    color: Colors.foam,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  subLabel: {
    marginTop: 2,
    fontWeight: '600',
    fontSize: 13,
    includeFontPadding: false,
  },
  primarySubText: {
    color: withAlpha(Colors.stout, 0.72),
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
