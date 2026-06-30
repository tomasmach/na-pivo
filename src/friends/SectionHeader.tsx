/**
 * SectionHeader — calm caption header for FriendsScreen groups.
 *
 * Spec §12: section headers are deliberately quiet captions on the bare
 * stout ground, NOT loud amber titles — this is what enforces the
 * "amber = alive" discipline across the whole screen. The single
 * exception is a live section (`TEĎ NA PIVU` when friends are live),
 * which earns a small amber `LiveDot` prefix.
 */

import React, { memo } from 'react';
import { StyleSheet, View, Text } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

import LiveDot from './LiveDot';

export interface SectionHeaderProps {
  /** Caption copy (already ALL-CAPS in cs.ts). */
  label: string;
  /** When true, prefix the caption with an amber pulsing LiveDot. */
  live?: boolean;
}

function SectionHeaderComponent({ label, live = false }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      {live ? <LiveDot size={7} /> : null}
      <Text
        style={styles.label}
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
    marginBottom: Spacing.sm,
  },
  label: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: Colors.mutedText,
    textTransform: 'uppercase',
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.border, 0.5),
  },
  ruleLive: {
    backgroundColor: withAlpha(Colors.amber, 0.35),
  },
});

/** Memoized: cheap, but isolates re-renders from the parent ScrollView. */
export default memo(SectionHeaderComponent);
