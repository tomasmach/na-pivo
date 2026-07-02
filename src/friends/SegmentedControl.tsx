/**
 * SegmentedControl — a two-option segmented switch (Parta 3.0 §B2).
 *
 * Reuses the RsvpControl track/thumb idiom (a single thumb that slides between
 * segments in one snappy 180 ms pass, no bounce) for the ComposeSheet KDE
 * (Poblíž / Nedávné) and KDY (Teď / Na čas) pickers. Unlike RsvpControl the
 * thumb is a NEUTRAL foam-wash — selecting a pub or a time is not a "live" state,
 * so it must not spend the reserved amber fill. Motion is reduce-motion gated
 * (the thumb snaps instead of sliding) and a light haptic fires on each switch.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

const SLIDE_MS = 180;
const TRACK_PADDING = 3;

export interface SegmentedControlProps {
  options: readonly [string, string];
  /** Selected segment index (0 or 1). */
  value: 0 | 1;
  onChange: (index: 0 | 1) => void;
  accessibilityLabel?: string;
}

function SegmentedControlBase({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps) {
  const reduceMotion = useReduceMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  const segW = trackWidth > 0 ? (trackWidth - TRACK_PADDING * 2) / 2 : 0;
  const measured = segW > 0;

  const pos = useSharedValue(value);

  useEffect(() => {
    if (!measured) return;
    pos.value = reduceMotion
      ? withTiming(value, { duration: 0 })
      : withTiming(value, { duration: SLIDE_MS, easing: Easing.out(Easing.cubic) });
  }, [value, measured, reduceMotion, pos]);

  useEffect(() => () => cancelAnimation(pos), [pos]);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
  }, []);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pos.value * segW }],
  }));

  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const lastValue = useRef(value);
  const handlePress = useCallback(
    (index: 0 | 1) => {
      if (index !== lastValue.current && hapticEnabled) fireLightImpactHaptic();
      lastValue.current = index;
      onChange(index);
    },
    [hapticEnabled, onChange],
  );

  return (
    <View
      style={styles.track}
      onLayout={onTrackLayout}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {measured ? (
        <Animated.View pointerEvents="none" style={[styles.thumb, { width: segW }, thumbStyle]} />
      ) : null}

      {options.map((label, i) => {
        const index = i as 0 | 1;
        const isSelected = value === index;
        return (
          <Pressable
            key={label}
            onPress={() => handlePress(index)}
            style={({ pressed }) => [styles.segment, pressed && styles.segmentPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
          >
            <Text
              style={[styles.segmentText, isSelected ? styles.segmentTextActive : null]}
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
    position: 'relative',
    height: 46,
    flexDirection: 'row',
    padding: TRACK_PADDING,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    left: TRACK_PADDING,
    top: TRACK_PADDING,
    height: 46 - TRACK_PADDING * 2,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  segment: {
    flex: 1,
    minHeight: HitArea.min - 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentPressed: {
    opacity: 0.9,
  },
  segmentText: {
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    textAlign: 'center',
    color: Colors.mutedText,
  },
  segmentTextActive: {
    color: Colors.foam,
  },
});

export default memo(SegmentedControlBase);
