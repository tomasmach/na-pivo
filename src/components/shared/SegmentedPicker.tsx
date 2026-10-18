/**
 * Segmented control (DESIGN.md §18). iOS renders the native SwiftUI picker from
 * `SegmentedPicker.ios.tsx`; this RN version is the Android fallback.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export interface SegmentedPickerProps {
  options: readonly string[];
  /** Selected segment index. */
  value: number;
  onChange: (index: number) => void;
  accessibilityLabel?: string;
  testID?: string;
  /** One per option, same order. */
  optionTestIDs?: readonly string[];
}

export default function SegmentedPicker({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
  optionTestIDs,
}: SegmentedPickerProps) {
  return (
    <View testID={testID} style={styles.track} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((label, index) => {
        const selected = value === index;
        return (
          <Pressable
            key={label}
            testID={optionTestIDs?.[index]}
            onPress={() => onChange(index)}
            style={({ pressed }) => [styles.segment, selected && styles.segmentActive, pressed && styles.pressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
          >
            <Text
              style={[styles.label, selected && styles.labelActive]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {label}
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
    minHeight: HitArea.min,
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.07),
  },
  segment: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: Colors.amber,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  labelActive: {
    color: Colors.stout,
  },
});
