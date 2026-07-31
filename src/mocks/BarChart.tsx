/**
 * DESIGN MOCK — Strava's profile bar chart.
 *
 * Vertical bars with the period under each and the current one filled solid.
 * No y-axis and no gridlines: the question a profile chart answers is "is it
 * going up or down", not "was it exactly seventeen", and the value sits on the
 * selected bar for the one time you do want the number.
 *
 * The bar you are ON is the last one, always highlighted — Strava does this and
 * it is why the chart reads as "where you are now" rather than as history.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

export interface BarPoint {
  label: string;
  value: number;
}

export function BarChart({
  points,
  height = 130,
  unit,
}: {
  points: BarPoint[];
  height?: number;
  /** Appended to the callout, e.g. "piv". */
  unit?: string;
}) {
  const [selected, setSelected] = React.useState<number | null>(null);
  const active = selected ?? points.length - 1;
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);

  if (points.length === 0) return null;

  return (
    <View>
      <View style={styles.callout}>
        <Text style={styles.calloutValue} allowFontScaling={false}>
          {points[active]?.value ?? 0}
          {unit ? <Text style={styles.calloutUnit}> {unit}</Text> : null}
        </Text>
        <Text style={styles.calloutLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {points[active]?.label}
        </Text>
      </View>

      <View style={[styles.plot, { height }]}>
        {points.map((point, index) => (
          <Pressable
            key={point.label}
            onPress={() => setSelected(index)}
            style={styles.col}
            accessibilityRole="button"
            accessibilityState={{ selected: index === active }}
            accessibilityLabel={`${point.label}: ${point.value}`}
          >
            <View style={styles.track}>
              <View
                style={[
                  styles.bar,
                  {
                    height: `${peak > 0 ? Math.max(3, (point.value / peak) * 100) : 3}%`,
                    backgroundColor:
                      index === active ? Colors.amber : withAlpha(Colors.amber, 0.28),
                  },
                ]}
              />
            </View>
            <Text
              style={[styles.tick, index === active && styles.tickOn]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {point.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  callout: { marginBottom: 10 },
  calloutValue: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  calloutUnit: { fontSize: 16, fontWeight: '600', color: Colors.mutedText, letterSpacing: 0 },
  calloutLabel: { fontSize: 13, fontWeight: '500', color: Colors.mutedText },

  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end', gap: 6 },
  track: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 5 },
  tick: { fontSize: 10, fontWeight: '500', color: Colors.mutedText, textAlign: 'center' },
  tickOn: { color: Colors.foam, fontWeight: '700' },
});
