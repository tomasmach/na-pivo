/**
 * Status strip — one sentence about the current data plus at most one action.
 *
 * DESIGN.md §"stale-data pruh": the strip is text, not an icon. Neutral state
 * sits on `foam 0.06`; an error adds the `amber 0.22` outline. The action is
 * amber text, never a second filled button.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export interface StatusStripAction {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}

export interface StatusStripProps {
  message: string;
  /** `error` adds the amber outline; `info` is the quiet "still loading" state. */
  tone?: 'info' | 'error';
  action?: StatusStripAction;
  style?: ViewStyle;
}

export const StatusStrip = memo(function StatusStrip({
  message,
  tone = 'info',
  action,
  style,
}: StatusStripProps) {
  return (
    <View style={[styles.strip, tone === 'error' && styles.stripError, style]}>
      <Text style={styles.message} maxFontSizeMultiplier={FontScaleCap.body}>
        {message}
      </Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
          accessibilityState={{ disabled: !!action.disabled }}
        >
          <Text style={styles.action} maxFontSizeMultiplier={FontScaleCap.body}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  strip: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.foam, 0.06),
  },
  stripError: {
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.22),
  },
  message: { flex: 1, fontSize: 12, fontWeight: '500', color: Colors.mutedText },
  action: { fontSize: 12, fontWeight: '800', color: Colors.amber },
});
