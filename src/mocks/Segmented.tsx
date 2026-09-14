/**
 * The segmented control — the real `UISegmentedControl`, not a drawing of one.
 *
 * It was hand-built: a track, a pill, two text weights. That gets the shape
 * right and everything else wrong — no press-and-slide, no keyboard focus ring,
 * no VoiceOver "tab, 2 of 3", and it drifts every time Apple restyles the
 * control. `@expo/ui` already ships SwiftUI's `Picker`, which IS the control,
 * and it is already in the Podfile, so this costs a dependency we have rather
 * than a new one.
 *
 * The amber comes through `seedColor` on the host: SwiftUI propagates it as the
 * environment tint, which on a segmented picker paints the selected pill. We do
 * not get to restyle the rest of it, and that is the point of using the system
 * control.
 *
 * Android has no equivalent SwiftUI host, so it keeps the hand-built track —
 * which is fine, because there it is not pretending to be a system control.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Host, Picker, Text as UIText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

/** UISegmentedControl's own height. Hard-coded because the host has to be
 *  given a size and `matchContents` on a control this small measures late,
 *  which shows up as the row jumping on first paint. */
const NATIVE_HEIGHT = 32;

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  if (Platform.OS === 'ios') {
    return (
      <Host style={{ height: NATIVE_HEIGHT }} colorScheme="dark" seedColor={Colors.amber}>
        <Picker
          selection={value}
          onSelectionChange={(next) => {
            if (typeof next === 'string') onChange(next as T);
          }}
          modifiers={[pickerStyle('segmented')]}
        >
          {options.map((option) => (
            <UIText key={option} modifiers={[tag(option)]}>
              {option}
            </UIText>
          ))}
        </Picker>
      </Host>
    );
  }

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
