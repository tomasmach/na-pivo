/**
 * OfflineBanner — Parta 2.0, layout spec §11.
 *
 * A deliberately *distinct* error/offline strip that can never be mistaken
 * for a warm "no friends" empty state: cool muted ink, no avatars, NO amber.
 * Rendered above everything when `loadError` is set (fetch failed / stale),
 * with the last-known dashboard still shown below it when available.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Undo2Icon, WifiIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface OfflineBannerProps {
  onRetry: () => void;
}

function OfflineBannerComponent({ onRetry }: OfflineBannerProps) {
  return (
    <View style={styles.strip}>
      <WifiIcon size={18} color={Colors.mutedText} />
      <Text
        style={styles.message}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {t.friends.offline}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t.friends.retry}
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
        style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
      >
        <Undo2Icon size={15} color={Colors.foamMuted} />
        <Text
          style={styles.retryLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {t.friends.retry}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.closed, 0.4),
    backgroundColor: withAlpha(Colors.stout2, 0.7),
  },
  message: {
    flex: 1,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  retry: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    backgroundColor: withAlpha(Colors.foam, 0.06),
  },
  retryPressed: {
    opacity: 0.6,
  },
  retryLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.foamMuted,
  },
});

export default memo(OfflineBannerComponent);
