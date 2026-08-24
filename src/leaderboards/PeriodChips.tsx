/**
 * PeriodChips — the quiet window picker under the metric switch (Týden ·
 * Letos · Celkem). Text-first chips, no track: the active one gets an amber
 * label and a hairline underline instead of a filled pill, so the row reads as
 * a setting, not a second tab bar. Amber planes stay on the CTA (§2.2).
 *
 * The Mapér board has a single all-time window, so the screen swaps this row
 * for a one-line note instead of offering a choice that does nothing.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LeaderboardPeriod } from '@/data/leaderboardsClient';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';

export interface PeriodChipsProps {
  options: readonly { key: LeaderboardPeriod; label: string }[];
  value: LeaderboardPeriod;
  onChange: (period: LeaderboardPeriod) => void;
  /** Screen-reader label for a single chip; defaults to its visible label. */
  describeOption?: (label: string, selected: boolean) => string;
  accessibilityLabel?: string;
}

function PeriodChipsBase({
  options,
  value,
  onChange,
  describeOption,
  accessibilityLabel,
}: PeriodChipsProps) {
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);

  const handlePress = useCallback(
    (period: LeaderboardPeriod) => {
      if (period !== value && hapticEnabled) fireLightImpactHaptic();
      onChange(period);
    },
    [hapticEnabled, onChange, value],
  );

  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map(({ key, label }) => {
        const isSelected = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => handlePress(key)}
            hitSlop={8}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={describeOption ? describeOption(label, isSelected) : label}
            style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
          >
            <Text
              style={[styles.chipText, isSelected && styles.chipTextActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {label}
            </Text>
            <View style={[styles.underline, isSelected && styles.underlineActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  chip: {
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  chipTextActive: {
    color: Colors.amber,
  },
  underline: {
    marginTop: Spacing.xs,
    height: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  underlineActive: {
    backgroundColor: withAlpha(Colors.amber, 0.8),
  },
});

export default memo(PeriodChipsBase);
