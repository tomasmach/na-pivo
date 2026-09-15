/**
 * BoardSegmented — the metric switch for the global leaderboards
 * (Pivaři · Objevitelé · Mapéři). Generalises the segmented track/thumb idiom
 * to N segments: one neutral foam-wash thumb sliding in a single 180 ms pass,
 * reduce-motion gated, light haptic per switch.
 *
 * The track sits on the bare screen background (`Colors.stout`), not inside a
 * card, so it is solid `stout3` rather than the foam-4 % wash used by the
 * in-card `LayerSwitch` — at 4 % over stout the track was invisible and the
 * whole control read as three loose words.
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
import { Radius, Spacing } from '@/theme/layout';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

const SLIDE_MS = 180;
const TRACK_HEIGHT = 44;
const TRACK_PADDING = 4;
const TRACK_BORDER = 1;
const SEGMENT_HEIGHT = TRACK_HEIGHT - TRACK_PADDING * 2;
/** Keeps the 44 pt touch target while the visual segment stays 36 pt tall. */
const VERTICAL_SLOP = TRACK_PADDING;

export interface BoardSegmentedProps {
  options: readonly string[];
  /** Selected segment index. */
  value: number;
  onChange: (index: number) => void;
  /** Screen-reader label for a single segment; defaults to its visible label. */
  describeOption?: (label: string, selected: boolean) => string;
  accessibilityLabel?: string;
}

function BoardSegmentedBase({
  options,
  value,
  onChange,
  describeOption,
  accessibilityLabel,
}: BoardSegmentedProps) {
  const reduceMotion = useReduceMotion();
  const [trackWidth, setTrackWidth] = useState(0);

  const count = Math.max(1, options.length);
  // onLayout reports the border box; the segments live inside border + padding.
  const segW = trackWidth > 0 ? (trackWidth - (TRACK_PADDING + TRACK_BORDER) * 2) / count : 0;
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
    (index: number) => {
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

      {options.map((label, index) => {
        const isSelected = value === index;
        return (
          <Pressable
            key={label}
            onPress={() => handlePress(index)}
            hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP }}
            style={({ pressed }) => [styles.segment, pressed && styles.segmentPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={describeOption ? describeOption(label, isSelected) : label}
          >
            <Text
              style={[styles.segmentText, isSelected ? styles.segmentTextActive : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
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
    height: TRACK_HEIGHT,
    flexDirection: 'row',
    padding: TRACK_PADDING,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: TRACK_BORDER,
    borderColor: withAlpha(Colors.border, 0.6),
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    left: TRACK_PADDING,
    top: TRACK_PADDING,
    height: SEGMENT_HEIGHT,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  segment: {
    flex: 1,
    minWidth: 0,
    height: SEGMENT_HEIGHT,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentPressed: {
    opacity: 0.9,
  },
  segmentText: {
    flexShrink: 1,
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    textAlign: 'center',
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  segmentTextActive: {
    color: Colors.foam,
  },
});

export default memo(BoardSegmentedBase);
