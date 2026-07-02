/**
 * LoopEmptyState — the warm "nobody is live right now" strip shown when
 * `myActiveActivity == null` AND there are no active friends (spec §11).
 *
 * Not a sad empty box: a muted bell, one organic line, and a single
 * secondary CTA that gives the fold a purposeful next action. Parta 3.0 (§B1)
 * points that CTA at the on-screen ComposeSheet (via `onPress`) instead of
 * routing away to the counter, so the verb never leaves the tab. The CTA's
 * amber-tinted secondary border is the one intentional accent here; the rest of
 * the strip stays on bare stout in `mutedText` (zero loud amber).
 */

import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { BellRingIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';

interface LoopEmptyStateProps {
  /** Opens the ComposeSheet. Falls back to routing to the counter when omitted. */
  onPress?: () => void;
}

function LoopEmptyStateBase({ onPress }: LoopEmptyStateProps) {
  const router = useRouter();

  return (
    <View style={styles.strip}>
      {/* Decorative bell — hidden from screen readers (the line carries it). */}
      <View
        importantForAccessibility="no"
        accessibilityElementsHidden
        pointerEvents="none"
      >
        <BellRingIcon size={28} color={Colors.mutedText} />
      </View>

      <Text
        style={styles.line}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {cs.friends.emptyActive}
      </Text>

      <View style={styles.ctaWrap}>
        <GlowButton
          label={cs.friends.loopEmptyCta}
          onPress={onPress ?? (() => router.push('/beer' as Href))}
          variant="secondary"
          glow="none"
          height={52}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.md,
  },
  line: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  ctaWrap: {
    alignSelf: 'stretch',
    marginTop: Spacing.xs,
  },
});

export default memo(LoopEmptyStateBase);
