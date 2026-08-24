/**
 * SectionHeader — composed section title for FriendsScreen groups.
 *
 * Parta used to read as a stack of technical all-caps captions. These headers
 * now behave like quiet app titles: sentence case, stronger type, and only a
 * short trailing rule so the page keeps rhythm without feeling like a table.
 */

import React, { memo } from 'react';
import { StyleSheet, View, Text } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

import LiveDotView from './LiveDot';

export interface SectionHeaderProps {
  /** Section title copy. */
  label: string;
  /** When true, prefix the caption with an amber pulsing LiveDot. */
  live?: boolean;
  /** Freeze the live dot dim while the dashboard is stale (§2C). */
  stale?: boolean;
}

function SectionHeaderComponent({ label, live = false, stale = false }: SectionHeaderProps) {
  const compactCaption = label.length <= 4 && label === label.toLocaleUpperCase('cs-CZ');

  return (
    <View style={styles.row}>
      {live ? <LiveDotView size={7} stale={stale} /> : null}
      <Text
        style={[styles.label, compactCaption && styles.labelCompact, live && styles.labelLive]}
        numberOfLines={1}
        accessibilityRole="header"
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {label}
      </Text>
      {/* Trailing hairline that runs the caption out to the screen edge — the
          quiet "this is a section" cue that makes each group feel composed. */}
      <View
        style={[styles.rule, live && styles.ruleLive]}
        pointerEvents="none"
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  label: {
    fontWeight: '800',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.15,
    color: Colors.foam,
  },
  labelLive: {
    color: Colors.amberLight,
  },
  labelCompact: {
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.4,
    color: Colors.mutedText,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.border, 0.42),
  },
  ruleLive: {
    backgroundColor: withAlpha(Colors.amber, 0.35),
  },
});

/** Memoized: cheap, but isolates re-renders from the parent ScrollView. */
export default memo(SectionHeaderComponent);
