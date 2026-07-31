/**
 * DESIGN MOCK — the Strava stat block.
 *
 * Taken straight from the references in `docs/references/`: a small muted label
 * ABOVE a big heavy value, and NO dividers between columns. The grid spacing is
 * the separator. Getting this the wrong way round (value on top, hairlines
 * between) is what made the first pass still read as the old app.
 *
 * Two shapes, both from the references:
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
          <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {stat.label}
          </Text>
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
    marginBottom: 2,
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
