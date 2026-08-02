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

import { TrophyIcon } from '@/components/shared/IconGlyph';
import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

export interface Stat {
  label: string;
  value: string;
  /** Rendered before the value, e.g. a trophy for achievements. */
  glyph?: React.ReactNode;
  /**
   * This number is a personal best.
   *
   * Marked, not shouted: a small amber PR beside the label. The number stays the
   * number — a record is a fact ABOUT it, so it sits with the caption rather
   * than decorating the numeral or recolouring it.
   */
  record?: boolean;
}

export function StatGrid({
  stats,
  columns = 3,
  compact = false,
  hero = false,
}: {
  stats: Stat[];
  columns?: 2 | 3 | 4;
  compact?: boolean;
  /** Detail-screen scale. The recap used to hand-roll this at 38pt in a flex row
   *  with no width bound, so "6h 42m" ran straight into the next column. */
  hero?: boolean;
}) {
  return (
    <View style={styles.grid}>
      {stats.map((stat, index) => {
        // The last cell of each ROW hugs the right edge, so the block spans the
        // full width instead of trailing off with a ragged gap after it. Per row,
        // not just the final stat — a 2-column grid wraps, and right-aligning
        // only the very last cell would single one out.
        const endsRow = index % columns === columns - 1;
        return (
        <View
          key={stat.label}
          style={[
            styles.cell,
            { width: `${100 / columns}%` },
            columns === 2 && styles.cellRoomy,
            endsRow && styles.cellEnd,
          ]}
        >
          <View style={[styles.valueRow, endsRow && styles.rowEnd]}>
            {stat.glyph}
            <Text
              style={[
                styles.value,
                compact && styles.valueCompact,
                hero && styles.valueHero,
                endsRow && styles.textEnd,
              ]}
              numberOfLines={1}
              allowFontScaling={false}
              // The cell has an explicit percentage width, so the text is
              // genuinely bounded and this shrinks rather than truncates. In the
              // old hand-rolled flex row it had nothing to measure against,
              // which is why "6h 42m" came out as "6h 4…".
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {stat.value}
            </Text>
          </View>
          <View style={[styles.labelRow, endsRow && styles.rowEnd]}>
            <Text
              style={[styles.label, endsRow && styles.textEnd]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {stat.label}
            </Text>
            {stat.record ? (
              <View style={styles.pr}>
                <TrophyIcon size={9} color={Colors.stout} />
                <Text style={styles.prText} allowFontScaling={false}>
                  PR
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { paddingRight: Spacing.sm },
  cellEnd: { paddingRight: 0, alignItems: 'flex-end' },
  rowEnd: { justifyContent: 'flex-end' },
  textEnd: { textAlign: 'right' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: Colors.amber,
  },
  prText: { fontSize: 9, fontWeight: '800', color: Colors.stout, letterSpacing: 0.2 },
  cellRoomy: { marginBottom: Spacing.lg },
  label: {
    fontWeight: '400',
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 2,
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  /**
   * The one place the app is not on the system font.
   *
   * SF is neutral by design — correct for a settings row, wrong for the number
   * that says how the night went. In SF these read as a spreadsheet; in Baloo
   * they read as the app. Line height is 1.24× because Baloo 2 ExtraBold
   * overshoots its box (§3.2).
   */
  value: {
    fontFamily: Fonts.numeral,
    fontSize: 22,
    lineHeight: 27,
    color: Colors.foam,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
  },
  valueCompact: { fontSize: 19, lineHeight: 24 },
  valueHero: { fontSize: 34, lineHeight: 42, letterSpacing: -0.6 },
});
