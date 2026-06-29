/**
 * BetaBadge — a tiny "Beta" tag for features still finding their feet.
 *
 * Two tones so it reads correctly on either surface:
 *  - 'amber'  pops on a dark stout background (e.g. a sheet title)
 *  - 'muted'  stays a quiet tag on an already amber-tinted surface (e.g. the
 *             amber scan pill) instead of fighting the accent
 */

import React, { memo } from 'react';
import { Text, View, StyleSheet } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

interface BetaBadgeProps {
  tone?: 'amber' | 'muted';
}

function BetaBadgeImpl({ tone = 'amber' }: BetaBadgeProps) {
  const isAmber = tone === 'amber';
  return (
    <View
      style={[styles.badge, isAmber ? styles.amber : styles.muted]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text
        style={[styles.text, isAmber ? styles.textAmber : styles.textMuted]}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        Beta
      </Text>
    </View>
  );
}

export const BetaBadge = memo(BetaBadgeImpl);

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  amber: {
    backgroundColor: withAlpha(Colors.amber, 0.18),
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  muted: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
    borderColor: withAlpha(Colors.foam, 0.2),
  },
  text: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  textAmber: {
    color: Colors.amberLight,
  },
  textMuted: {
    color: Colors.foamMuted,
  },
});
