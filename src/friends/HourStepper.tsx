/**
 * HourStepper — Parta 2.0 quiet-hours hour picker (spec §14).
 *
 * Two −/+ pill buttons (≥44 tap targets) flanking a big Baloo2 hour numeral
 * rendered as a clock time (`HH:00`). The value wrap-clamps 0–23: stepping
 * past 23 lands on 0, stepping below 0 lands on 23. The caller owns debouncing
 * the PATCH to the settings endpoint — this component only emits each new hour.
 *
 * Press feedback is the instant `Pressable` pressed style (no animation), so
 * there is nothing to gate on reduce-motion. Haptics fire on every step, gated
 * on the user's haptic setting, matching the rest of the app.
 */

import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MinusIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';

export interface HourStepperProps {
  value: number;
  onChange: (hour: number) => void;
  accessibilityLabel: string;
}

const HOURS_IN_DAY = 24;

/** Wrap an arbitrary integer into the 0–23 hour range (−1 → 23, 24 → 0). */
function wrapHour(hour: number): number {
  return ((Math.round(hour) % HOURS_IN_DAY) + HOURS_IN_DAY) % HOURS_IN_DAY;
}

function pad2(hour: number): string {
  return hour < 10 ? `0${hour}` : String(hour);
}

const HourStepper = memo(function HourStepper({
  value,
  onChange,
  accessibilityLabel,
}: HourStepperProps) {
  const hour = wrapHour(value);

  const step = useCallback(
    (delta: number) => {
      if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
      onChange(wrapHour(hour + delta));
    },
    [hour, onChange],
  );

  const handleDecrement = useCallback(() => step(-1), [step]);
  const handleIncrement = useCallback(() => step(1), [step]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={handleDecrement}
        hitSlop={Spacing.xs}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}: ${cs.friends.hourStepperDecrement}`}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <MinusIcon size={20} color={Colors.foamMuted} />
      </Pressable>

      <Text
        style={styles.value}
        allowFontScaling={false}
        maxFontSizeMultiplier={FontScaleCap.display}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${accessibilityLabel}: ${pad2(hour)}:00`}
      >
        {pad2(hour)}
        <Text
          style={styles.suffix}
          allowFontScaling={false}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          :00
        </Text>
      </Text>

      <Pressable
        onPress={handleIncrement}
        hitSlop={Spacing.xs}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}: ${cs.friends.hourStepperIncrement}`}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <PlusIcon size={20} color={Colors.foamMuted} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  pill: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.06),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  pillPressed: {
    opacity: 0.6,
    transform: [{ scale: 0.94 }],
  },
  value: {
    minWidth: 72,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 26,
    color: Colors.foam,
  },
  suffix: {
    fontFamily: Fonts.display.semibold,
    fontSize: 20,
    color: Colors.mutedText,
  },
});

export default HourStepper;
