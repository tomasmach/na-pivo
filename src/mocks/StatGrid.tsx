/**
 * DESIGN MOCK — the stat block.
 *
 * A big heavy value with a small muted label UNDER it, and NO dividers between
 * columns — the grid spacing is the separator.
 *
 * Strava puts the label above, and this deliberately does not. Above works on a
 * screen where the row stands alone; here the profile stacks a period label over
 * it, so you got three sizes of small text before reaching a number. Value first
 * also matches how the rest of 3.0 already reads — the hub's numerals carry
 * their unit inline, the challenge count leads with the figure.
 *
 * One order everywhere. This block is on the feed card, the party hub, the
 * recap, the profile, the pub detail and the finish screen, and two orders would
 * mean the same numbers read differently depending on where you met them.
 *
 * Two shapes:
 *   `columns={3|4}`  one row, used on a feed card
 *   `columns={2}`    wrapping grid, used on a detail screen
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export interface Stat {
  label: string;
  value: string;
  /** Rendered before the value, e.g. a trophy for achievements. */
  glyph?: React.ReactNode;
}

export function StatGrid({
  stats,
  columns = 3,
  compact = false,
}: {
  stats: Stat[];
  columns?: 2 | 3 | 4;
  compact?: boolean;
}) {
  return (
    <View style={styles.grid}>
      {stats.map((stat) => (
        <View
          key={stat.label}
          style={[
            styles.cell,
            { width: `${100 / columns}%` },
            columns === 2 && styles.cellRoomy,
          ]}
        >
          <View style={styles.valueRow}>
            {stat.glyph}
            <Text
              style={[styles.value, compact && styles.valueCompact]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {stat.value}
            </Text>
          </View>
          <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {stat.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { paddingRight: Spacing.sm },
  cellRoomy: { marginBottom: Spacing.lg },
  label: {
    fontWeight: '400',
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 2,
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  value: {
    fontWeight: '700',
    fontSize: 22,
    color: Colors.foam,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  valueCompact: { fontSize: 19 },
});
