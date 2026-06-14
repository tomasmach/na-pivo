/**
 * The "co padlo" breakdown for one evening — one row per beer + volume, with a
 * per-beer count and subtotal, then the evening total. Shared by the current
 * evening card and the evening detail. Pure presentational; data comes from
 * sessionBreakdown().
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { cs, formatVolume } from '@/i18n/cs';
import { formatPrice, type PriceCurrency } from '@/utils/currency';
import type { BreakdownLine } from '@/myBeers/eveningModel';

interface EveningBreakdownProps {
  lines: BreakdownLine[];
  totalCzk: number;
  priceCurrency: PriceCurrency;
  showTotal?: boolean;
}

export function EveningBreakdown({
  lines,
  totalCzk,
  priceCurrency,
  showTotal = true,
}: EveningBreakdownProps) {
  return (
    <View>
      {lines.map((line, i) => (
        <View
          key={`${line.name}|${line.volumeMl ?? ''}`}
          style={[styles.row, i > 0 && styles.rowBorder]}
        >
          <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {line.volumeMl ? `${line.name} · ${formatVolume(line.volumeMl)}` : line.name}
          </Text>
          <Text style={styles.meta} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.myBeers.breakdownLine(line.count, formatPrice(line.totalCzk, priceCurrency))}
          </Text>
        </View>
      ))}

      {showTotal && (
        <View style={[styles.row, styles.totalRow]}>
          <Text style={styles.totalLabel} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.myBeers.totalLabel}
          </Text>
          <Text style={styles.totalValue} maxFontSizeMultiplier={FontScaleCap.heading}>
            {formatPrice(totalCzk, priceCurrency)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  name: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  meta: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    marginTop: 2,
    paddingTop: Spacing.sm + 2,
  },
  totalLabel: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    color: Colors.mutedText,
  },
  totalValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
});
