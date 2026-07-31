/**
 * DESIGN MOCK — the segmented control, Spendee's shape.
 *
 * A track with a moving thumb, not a row of underlined words: an underline says
 * "these are pages"; a thumb inside a track says "this one control has one
 * answer". Screens use the underline for top-level sections and this for
 * switching what a single chart is showing, and keeping the two visually
 * distinct is the only reason both can be on screen at once.
 *
 * Equal columns, always — a thumb that resizes per label makes the control
 * twitch every time you change the answer.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.track}>
      {options.map((option) => {
        const on = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[styles.segment, on && styles.segmentOn]}
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
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.07),
  },
  segment: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  segmentOn: { backgroundColor: Colors.amber },
  label: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },
  labelOn: { color: Colors.stout, fontWeight: '700' },
});
