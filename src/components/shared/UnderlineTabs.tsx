/**
 * The section tabs — an underline, not a segmented control.
 *
 * An underline says "these are pages of one screen"; a track with a thumb
 * (`Segmented`) says "one control, one answer". Both are in the app on purpose
 * and they must not converge (§18.1).
 *
 * Two details that were wrong every time this got re-implemented:
 *
 *   - The rule runs the FULL WIDTH, bleeding past the screen padding. A bar that
 *     stops short of the edges floats; one that reaches them is a baseline the
 *     tabs sit on.
 *   - There is a muted track under all of them, and the active segment is a
 *     brighter piece OF it. A lone amber bar under one word, with nothing either
 *     side, is the loudest thing on a screen that is mostly reading.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';

export function UnderlineTabs<T extends string>({
  options,
  value,
  onChange,
  /** Horizontal screen padding to bleed the baseline past. */
  inset = 0,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  inset?: number;
}) {
  return (
    <View style={[styles.wrap, { marginHorizontal: -inset }]}>
      {options.map((option) => {
        const on = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={styles.tab}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option}
          >
            <Text
              style={[styles.label, on && styles.labelOn]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {option}
            </Text>
            <View style={[styles.rule, on && styles.ruleOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', gap: 8 },
  label: { fontSize: 16, fontWeight: '600', color: Colors.mutedText },
  labelOn: { color: Colors.foam, fontWeight: '700' },
  /** The baseline every tab sits on — quiet, and it reaches both edges. */
  rule: { height: 2, alignSelf: 'stretch', backgroundColor: withAlpha(Colors.foam, 0.09) },
  /** The active piece of that baseline. Muted amber, not full-strength: it marks
   *  where you are, it is not an action. */
  ruleOn: { backgroundColor: withAlpha(Colors.amber, 0.85) },
});
