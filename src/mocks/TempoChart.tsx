/**
 * Beers per hour — one chart, drawn the same way wherever the night is shown.
 *
 * The feed card's hero tile and the recap each had their own copy. They drifted
 * immediately: the feed grew a mug beside every tally so a bare 3 could not be
 * mistaken for anything else, and the recap stayed a naked numeral over a bar.
 *
 * No title and no summary line. The mug says WHAT is counted and the hour under
 * each bar says WHEN, which is the whole chart — a heading naming the axes and a
 * caption restating the peak were two sentences explaining four numbers.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BeerIcon } from '@/components/shared/IconGlyph';
import { Colors, withAlpha } from '@/theme/colors';
import { Spacing } from '@/theme/layout';

export function TempoChart({
  hourly,
  height,
}: {
  hourly: { hour: string; beers: number }[];
  /** Omit to fill the parent — the hero tile sizes it, the recap gives it room. */
  height?: number;
}) {
  const peak = hourly.reduce((max, slot) => Math.max(max, slot.beers), 0);
  if (hourly.length === 0) return null;

  return (
    <View style={[styles.row, height ? { height } : styles.fill]}>
      {hourly.map((slot) => (
        <View key={slot.hour} style={styles.col}>
          <View style={styles.valueRow}>
            <BeerIcon size={12} color={withAlpha(Colors.amber, 0.9)} />
            <Text style={styles.value} allowFontScaling={false}>
              {slot.beers}
            </Text>
          </View>
          <View style={styles.track}>
            <View
              style={[
                styles.bar,
                { height: `${peak > 0 ? Math.max(8, (slot.beers / peak) * 100) : 8}%` },
              ]}
            />
          </View>
          <Text style={styles.hour} allowFontScaling={false}>
            {slot.hour}:00
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  fill: { flex: 1 },
  col: { flex: 1, alignItems: 'center', gap: 5 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  value: { fontSize: 13, fontWeight: '700', color: Colors.foam },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6, backgroundColor: withAlpha(Colors.amber, 0.55) },
  hour: { fontSize: 11, fontWeight: '500', color: Colors.mutedText },
});
