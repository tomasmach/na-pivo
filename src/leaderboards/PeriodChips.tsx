/**
 * PeriodChips — the quiet window picker under the category switch (Týden ·
 * Rok · Celkem). Text-first chips, no track: the active one gets an amber
 * label + hairline underline instead of a filled pill, so the row reads as a
 * setting, not a second tab bar. Hidden entirely for the Mapér board (XP has
 * a single all-time window).
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';
import type { LeaderboardPeriod } from '@/data/leaderboardsClient';

export interface PeriodChipsProps {
  options: readonly { key: LeaderboardPeriod; label: string }[];
  value: LeaderboardPeriod;
  onChange: (period: LeaderboardPeriod) => void;
  accessibilityLabel?: string;
}

function PeriodChipsBase({ options, value, onChange, accessibilityLabel }: PeriodChipsProps) {
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
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
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
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  chip: {
    minHeight: HitArea.min - 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  chipTextActive: {
    color: Colors.amber,
  },
  underline: {
    marginTop: 3,
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
