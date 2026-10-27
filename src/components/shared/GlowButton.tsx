import React, { memo, ReactNode } from 'react';
import { ActivityIndicator, Text, View, StyleSheet, ViewStyle } from 'react-native';
import { PressScale, ScalePressable } from '@/components/shared/ScalePressable';
import { useTone } from '@/layout/pane';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
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
  testID?: string;
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
  testID,
  loading = false,
  disabled = false,
}: GlowButtonProps) {
  // The right half of a wide window leaves the amber to the left one.
  const tone = useTone();
  const isPrimary = variant === 'primary' && tone !== 'quiet';
  const glowStyle = resolveGlowStyle(glow);

  return (
    <ScalePressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      pressScale={isPrimary ? PressScale.primary : PressScale.default}
      style={[styles.wrapper, { height }]}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {/* The glow sits inside the pressable so it sinks with the button. */}
      {glow !== 'none' && isPrimary && (
        <View
          style={[
            styles.glowLayer,
            { height, borderRadius: Radius.pill },
            glowStyle,
          ]}
        />
      )}
      <View
        style={[
          styles.base,
          { height, borderRadius: Radius.pill },
          isPrimary ? styles.primaryBg : styles.secondaryBg,
          (disabled || loading) && styles.disabled,
        ]}
      >
        <View style={styles.labelRow}>
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
      </View>
    </ScalePressable>
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
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: 'transparent',
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  subLabel: {
    marginTop: 2,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    includeFontPadding: false,
  },
  primarySubText: {
    color: withAlpha(Colors.stout, 0.72),
  },
  iconSlot: {
    marginRight: 4,
  },
  disabled: {
    opacity: 0.7,
  },
});
