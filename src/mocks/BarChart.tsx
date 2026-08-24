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
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';

export interface BarPoint {
  label: string;
  value: number;
}

export function barIndexAt(x: number, width: number, count: number): number | null {
  if (count <= 0 || !Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return null;
  return Math.max(0, Math.min(count - 1, Math.floor((x / width) * count)));
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
  const [plotWidth, setPlotWidth] = React.useState(0);
  const peak = points.reduce((max, point) => Math.max(max, point.value), 0);

  const scrub = React.useCallback(
    (index: number | null) => {
      setActive(index);
      onScrub?.(index);
    },
    [onScrub],
  );

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        // A still finger remains the individual bar's Pressable. Once it moves,
        // the plot takes the responder and walks through buckets by x position.
        onStartShouldSetPanResponder: () => false,
        // Only a decisively horizontal drag: the chart lives inside a scrolling
        // page, and capturing any movement made the chart a dead zone for
        // scrolling — a vertical swipe scrubbed bars instead of moving the page.
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: (event) => {
          scrub(barIndexAt(event.nativeEvent.locationX, plotWidth, points.length));
        },
        onPanResponderMove: (event) => {
          scrub(barIndexAt(event.nativeEvent.locationX, plotWidth, points.length));
        },
        onPanResponderRelease: () => scrub(null),
        onPanResponderTerminate: () => scrub(null),
        onPanResponderTerminationRequest: () => false,
      }),
    [plotWidth, points.length, scrub],
  );

  if (points.length === 0) return null;

  return (
    <View
      testID="bar-chart-plot"
      style={[styles.plot, { height }]}
      onLayout={(event) => {
        setPlotWidth(event.nativeEvent.layout.width);
      }}
      {...pan.panHandlers}
    >
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
