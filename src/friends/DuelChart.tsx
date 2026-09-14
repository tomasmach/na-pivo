/**
 * The head-to-head months: my column and theirs, side by side.
 *
 * Deliberately the Výkon screen's month chart with a second bar slotted into
 * each column — same geometry, same amber, same "an empty month still gets a
 * column" rule. A duel needs two series and neither existing chart draws two,
 * but that is a reason to extend the vocabulary by one bar, not to invent a
 * chart with its own axes and gridlines.
 *
 * Mine is solid amber, theirs is the dimmed amber the profile chart already
 * uses for an unlit bar. Colour alone would not be enough, so the legend names
 * both and the a11y label reads the pair out per month.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { DuelMonth } from '@/data/friendsClient';
import { intlLocale, t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

/** Usable pixels for a bar inside the plot, after the month label. */
const PLOT_HEIGHT = 96;
/** A month with no beer keeps a visible stub, so the gap reads as zero. */
const EMPTY_BAR = 3;

function monthLabel(iso: string): string {
  const parsed = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale, { month: 'short' }).format(parsed).replace('.', '');
}

function barHeight(value: number, peak: number): number {
  if (value <= 0) return EMPTY_BAR;
  return Math.max(8, Math.round((value / peak) * PLOT_HEIGHT));
}

export const DuelChart = memo(function DuelChart({
  series,
  friendName,
}: {
  series: DuelMonth[];
  friendName: string;
}) {
  if (series.length === 0) return null;
  const peak = Math.max(1, ...series.flatMap((row) => [row.me, row.friend]));

  return (
    <View>
      <View style={styles.plot}>
        {series.map((row) => (
          <View
            key={row.month}
            style={styles.column}
            accessible
            accessibilityLabel={t.souboj.chartMonthA11y(
              monthLabel(row.month),
              row.me,
              friendName,
              row.friend,
            )}
          >
            <View style={styles.bars}>
              <View
                style={[
                  styles.bar,
                  styles.barMine,
                  row.me === 0 && styles.barEmpty,
                  { height: barHeight(row.me, peak) },
                ]}
              />
              <View
                style={[
                  styles.bar,
                  styles.barTheirs,
                  row.friend === 0 && styles.barEmpty,
                  { height: barHeight(row.friend, peak) },
                ]}
              />
            </View>
            <Text style={styles.monthLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {monthLabel(row.month)}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.legendItem}>
          <View style={[styles.swatch, styles.barMine]} />
          <Text style={styles.legendText} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.souboj.legendMe}
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, styles.barTheirs]} />
          <Text
            style={styles.legendText}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {friendName}
          </Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  plot: { height: PLOT_HEIGHT + 20, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  column: { flex: 1, alignItems: 'center' },
  bars: {
    height: PLOT_HEIGHT,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 3,
  },
  bar: { flex: 1, borderRadius: 3 },
  barMine: { backgroundColor: Colors.amber },
  barTheirs: { backgroundColor: withAlpha(Colors.amber, 0.28) },
  barEmpty: { backgroundColor: withAlpha(Colors.foam, 0.1) },
  monthLabel: { fontWeight: '600', fontSize: 10, color: Colors.mutedText, marginTop: 6 },
  legend: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.md },
  legendItem: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 9, height: 9, borderRadius: 2 },
  legendText: { flexShrink: 1, fontSize: 12, fontWeight: '600', color: Colors.mutedText },
});
