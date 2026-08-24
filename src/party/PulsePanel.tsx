/**
 * DESIGN MOCK — the night's numbers, at the top of the hub.
 *
 * It started as Strava's record panel: a coloured band naming the state, the
 * numbers under it, all inside a card. The card was the problem — a panel drawn
 * around the biggest numbers on the screen frames them as a widget, when they
 * ARE the screen. So the box goes and the numerals sit straight on the ground,
 * big enough to read from across the table.
 *
 * They are not tappable. Tapping used to blow them up full screen, but nothing
 * on the hub opens anything else, and a block that looks like a heading and
 * behaves like a button is a trap you find by accident.
 *
 * Which numbers appear is `hubStats`' decision, not this component's — see
 * `nightPulse.ts`. Here they are only laid out: equal columns, value over unit,
 * the clock last because it is the one that never stops moving.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { formatStopwatch, useNightSeconds } from '@/mocks/livePartyStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export interface PulseStat {
  value: string;
  /** Rides with the numeral instead of captioning it. */
  unit?: string;
}

/**
 * The running clock, on its own.
 *
 * Its own component because it ticks every second: keeping the hook here means
 * one `<Text>` re-renders sixty times a minute instead of the whole hub, which
 * would redraw a SwiftUI chart for a digit.
 */
function Stopwatch({ startedAt }: { startedAt: number }) {
  const seconds = useNightSeconds(startedAt);
  return (
    <Text
      style={styles.value}
      allowFontScaling={false}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
    >
      {formatStopwatch(seconds)}
    </Text>
  );
}

export function PulsePanel({
  stats,
  startedAt,
}: {
  /** Whatever is worth knowing right now; the clock is added after them. */
  stats: PulseStat[];
  startedAt: number | null;
}) {
  return (
    <View style={styles.row}>
      {stats.map((stat) => (
        <View key={`${stat.value}-${stat.unit ?? ''}`} style={styles.col}>
          <Text
            style={styles.value}
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {stat.value}
          </Text>
          <Text style={styles.label} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {stat.unit ?? ''}
          </Text>
        </View>
      ))}
      <View style={styles.col}>
        {startedAt === null ? (
          <Text
            style={styles.value}
            allowFontScaling={false}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            0:00
          </Text>
        ) : (
          <Stopwatch startedAt={startedAt} />
        )}
        <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
          večer
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Air above: the numbers are the headline of the sheet, and sitting them
  // straight under the faces made them read as a caption to the guest list.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginTop: Spacing.sm },
  col: { flex: 1 },
  value: {
    fontFamily: Fonts.numeral,
    // Big enough to be the infographic rather than a row of figures. At 26 they
    // were the same weight as the log under them and the eye had no first stop.
    fontSize: 33,
    lineHeight: 40,
    letterSpacing: -0.5,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  label: { fontSize: 13, fontWeight: '500', color: Colors.mutedText, marginTop: 3 },
});
