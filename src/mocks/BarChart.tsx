/**
 * DESIGN MOCK — Strava's profile bar chart, scrubbable.
 *
 * Vertical bars with the period under each and the current one filled solid.
 * No y-axis and no gridlines: the question a profile chart answers is "is it
 * going up or down", not "was it exactly seventeen".
 *
 * There is no value callout on the chart any more. It used to print "48 piv /
 * čvc" above the bars, directly under a header already showing four numbers for
 * the same window — the same fact twice, in two type sizes. Instead, touching a
 * bar re-points the HEADER at that bucket, so the big numbers always describe
 * whatever your finger is on and there is only ever one place to read them.
 *
 * Scrub, not tap: `onPressIn` plus a pan, so dragging across the chart walks the
 * header through the year. Lifting off restores the whole window.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';

export interface BarPoint {
  label: string;
  value: number;
}

export function BarChart({
  points,
  height = 150,
  onScrub,
}: {
  points: BarPoint[];
  height?: number;
  /** Fires with the touched index, or null when the finger lifts. */
  onScrub?: (index: number | null) => void;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);

  const scrub = (index: number | null) => {
    setActive(index);
    onScrub?.(index);
  };

  if (points.length === 0) return null;

  return (
    <View style={[styles.plot, { height }]}>
      {points.map((point, index) => {
        // Nothing scrubbed → the newest bar is lit, because that is where you
        // are now and a chart with no highlight reads as inert history.
        const lit = active === null ? index === points.length - 1 : index === active;
        return (
          <Pressable
            key={point.label}
            onPressIn={() => scrub(index)}
            onPressOut={() => scrub(null)}
            style={styles.col}
            accessibilityRole="button"
            accessibilityLabel={`${point.label}: ${point.value}`}
          >
            <View style={styles.track}>
              <View
                style={[
                  styles.bar,
                  {
                    height: `${peak > 0 ? Math.max(3, (point.value / peak) * 100) : 3}%`,
                    backgroundColor: lit ? Colors.amber : withAlpha(Colors.amber, 0.28),
                  },
                ]}
              />
            </View>
            <Text
              style={[styles.tick, lit && styles.tickOn]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {point.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end', gap: 6 },
  track: { flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 5 },
  tick: { fontSize: 10, fontWeight: '500', color: Colors.mutedText, textAlign: 'center' },
  tickOn: { color: Colors.foam, fontWeight: '700' },
});
