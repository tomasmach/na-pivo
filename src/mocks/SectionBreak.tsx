/**
 * DESIGN MOCK — the gap between sections, as a band rather than a hairline.
 *
 * The feed already does this between posts and it is the reason that screen
 * reads as a stack of separate things: a 1px line between two areas of the same
 * colour just makes one long panel with a scratch across it, while a band of a
 * DARKER colour reads as the space between two cards.
 *
 * Everywhere else was still separating sections with margin alone, so a profile
 * ran "chart, totals, streak, records, badges" as one undifferentiated column.
 *
 * It bleeds past the screen padding on purpose — a gap that stops short of the
 * edges is a divider, and a divider is the thing this replaces.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

/** Darker than every ground in the app, so it always reads as the gap. */
export const BAND_COLOR = '#0F0A05';

export function SectionBreak({
  title,
  /** Horizontal screen padding to bleed past. */
  inset = MockLayout.screenPad,
}: {
  /** Rendered under the band, so the heading belongs to what follows it. */
  title?: string;
  inset?: number;
}) {
  return (
    <>
      <View style={[styles.band, { marginHorizontal: -inset }]} />
      {title ? (
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {title}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  band: {
    height: 10,
    backgroundColor: BAND_COLOR,
    marginTop: Spacing.xl,
  },
  // Air on BOTH sides. The band gives the heading room above it; without a
  // margin below, the heading sat straight on the first row and read as part of
  // it rather than as its title.
  title: {
    ...MockType.titleS,
    color: Colors.foam,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
});
