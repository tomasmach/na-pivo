/**
 * CounterCta — block 4 of the "Tácek" counter screen: the ONE big amber
 * button at the bottom. Design rule enforced here: this is the single
 * glowing element on the screen, and its label always states exactly what
 * one tap will do. Presentational only: props in, callbacks out. Presses
 * are debounced internally (700 ms) so a fumbled double-tap in a pub can
 * never log two beers.
 */
import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';
import { amberGlowStrong } from '@/theme/shadows';

const CTA_HEIGHT = 84;
const PRESS_SWALLOW_MS = 700;

export interface CounterCtaProps {
  label: string;
  subLabel?: string | null;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
}

export interface CounterSecondaryProps {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

/** The quiet twin under the CTA: "Něco jiného" — a different beer, a shot, a
 *  Kofola. Outlined, never filled, so the amber button stays the one obvious
 *  target — but it is always on screen, because "the same again" must never be
 *  the only visible way to log a drink. */
export const CounterSecondary = memo(function CounterSecondary({
  label,
  onPress,
  accessibilityLabel,
}: CounterSecondaryProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={styles.secondaryLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
});

export const CounterCta = memo(function CounterCta({
  label,
  subLabel,
  onPress,
  accessibilityLabel,
  disabled = false,
}: CounterCtaProps) {
  // Debounce ref: timestamp of the last accepted press. No state — swallowed
  // presses produce no visual change at all.
  const lastPressAtRef = useRef(0);

  // A new label means a new action, so the swallow window must not block it.
  useEffect(() => {
    lastPressAtRef.current = 0;
  }, [label]);

  const handlePress = useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastPressAtRef.current < PRESS_SWALLOW_MS) return;
    lastPressAtRef.current = now;
    onPress();
  }, [disabled, onPress]);

  return (
    <View style={styles.wrapper}>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.button,
          disabled ? styles.buttonDisabled : amberGlowStrong(22),
          pressed && !disabled && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
      >
        {/* A single hairline of light along the top edge: enough to make the
            button read as a lit physical surface instead of a flat swatch. */}
        {!disabled ? <View style={styles.topLight} pointerEvents="none" /> : null}
        <Text
          style={[styles.label, disabled && styles.labelDisabled]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {label}
        </Text>
        {subLabel != null && subLabel !== '' && (
          <Text
            style={[styles.subLabel, disabled && styles.subLabelDisabled]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {subLabel}
          </Text>
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    justifyContent: 'center',
    height: CTA_HEIGHT,
  },
  button: {
    height: CTA_HEIGHT,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    overflow: 'hidden',
  },
  buttonDisabled: {
    backgroundColor: withAlpha(Colors.amber, 0.3),
  },
  topLight: {
    position: 'absolute',
    top: 0,
    left: '12%',
    right: '12%',
    height: 1,
    backgroundColor: withAlpha(Colors.foam, 0.55),
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  label: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    color: Colors.stout,
    textAlign: 'center',
    includeFontPadding: false,
  },
  labelDisabled: {
    color: withAlpha(Colors.stout, 0.55),
  },
  subLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: withAlpha(Colors.stout, 0.72),
    marginTop: 2,
    includeFontPadding: false,
  },
  subLabelDisabled: {
    color: withAlpha(Colors.stout, 0.55),
  },
  // The secondary carries the accent at 5-6%: enough to read as part of the
  // same family, nowhere near enough to compete with the filled button above.
  secondary: {
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.18),
    backgroundColor: withAlpha(Colors.amber, 0.06),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  secondaryPressed: {
    opacity: 0.7,
  },
  secondaryLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
});
