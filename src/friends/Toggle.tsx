/**
 * Toggle — animated switch used inside the FriendSettingsSheet (ghost mode,
 * quiet hours). Cloned from the settings screen `Toggle` so the two read
 * identically: amber track when on, stout3 well when off, foam knob that
 * springs across.
 *
 * Self-contained: owns its own styles and imports only theme tokens. The thumb
 * stays in sync with the controlled `value` so an async PATCH that rejects
 * (and leaves `value` where it was) snaps the knob back.
 */

import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/theme/colors';
import { Radius } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

const THUMB_OFF = 2;
const THUMB_ON = 24;

interface ToggleProps {
  value: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
}

function Toggle({ value, onToggle, accessibilityLabel }: ToggleProps) {
  const reduceMotion = useReduceMotion();
  const offset = useSharedValue(value ? THUMB_ON : THUMB_OFF);

  useEffect(() => {
    const target = value ? THUMB_ON : THUMB_OFF;
    offset.value = reduceMotion
      ? withTiming(target, { duration: 0 })
      : withSpring(target, { mass: 0.6, damping: 14, stiffness: 200 });
  }, [value, reduceMotion, offset]);

  const handlePress = useCallback(() => {
    onToggle();
  }, [onToggle]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
    >
      <Animated.View style={[styles.toggleThumb, softDrop(), thumbStyle]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 52,
    height: 30,
    borderRadius: Radius.pill,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: Colors.amber,
  },
  toggleOff: {
    backgroundColor: Colors.stout3,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foam,
  },
});

export default React.memo(Toggle);
