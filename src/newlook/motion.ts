import { useEffect } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Easing,
  LinearTransition,
  ReduceMotion,
  useSharedValue,
  withTiming,
  type EntryExitAnimationFunction,
  type SharedValue,
  type WithTimingConfig,
} from 'react-native-reanimated';

/**
 * The one motion system of the new look: short timings that settle without
 * overshoot, opacity plus small moves. No springs, no bounce, no zoom.
 */
export const DURATION = { press: 120, fast: 160, base: 220, sheet: 280 } as const;

/** Decelerates into place. */
export const EASE_ENTER = Easing.bezier(0.2, 0, 0, 1);
/** Accelerates away, a little quicker than the entry. */
export const EASE_EXIT = Easing.bezier(0.3, 0, 1, 1);
/** Close to the iOS keyboard curve, so lifted content rides with the keyboard. */
const EASE_KEYBOARD = Easing.bezier(0.38, 0.7, 0.125, 1);

// Opacity still fades with Reduce Motion on; movement jumps straight to its end.
const fadeConfig = (duration: number, easing: WithTimingConfig['easing']): WithTimingConfig => ({
  duration,
  easing,
  reduceMotion: ReduceMotion.Never,
});
const moveConfig = (duration: number, easing: WithTimingConfig['easing']): WithTimingConfig => ({
  duration,
  easing,
  reduceMotion: ReduceMotion.System,
});

export const enterTiming = (duration: number = DURATION.base) => moveConfig(duration, EASE_ENTER);
export const exitTiming = (duration: number = DURATION.fast) => moveConfig(duration, EASE_EXIT);
export const fadeInTiming = (duration: number = DURATION.base) => fadeConfig(duration, EASE_ENTER);
export const fadeOutTiming = (duration: number = DURATION.fast) => fadeConfig(duration, EASE_EXIT);

/** Fades in, rising `dy` points (negative comes down from above). */
export function enter(dy = 0, duration: number = DURATION.base): EntryExitAnimationFunction {
  const fade = fadeInTiming(duration);
  const move = enterTiming(duration);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: dy }] },
      animations: { opacity: withTiming(1, fade), transform: [{ translateY: withTiming(0, move) }] },
    };
  };
}

/** Fades out, moving `dy` points on the way. */
export function exit(dy = 0, duration: number = DURATION.fast): EntryExitAnimationFunction {
  const fade = fadeOutTiming(duration);
  const move = exitTiming(duration);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
      animations: { opacity: withTiming(0, fade), transform: [{ translateY: withTiming(dy, move) }] },
    };
  };
}

export const fadeIn = enter(0);
export const fadeOut = exit(0);
/** A floating element at the bottom edge: rises a few points while it fades in. */
export const riseIn = enter(8);
export const sinkOut = exit(8);
/** A view that changes place within its parent glides there. */
export const layoutMove = LinearTransition.duration(DURATION.base).easing(EASE_ENTER);

/**
 * Keyboard height that animates with the keyboard itself instead of jumping
 * to the final height when the keyboard starts to move.
 */
export function useKeyboardLift(): SharedValue<number> {
  const lift = useSharedValue(0);
  // React Native on Android reports the keyboard height without the navigation bar under it.
  const insets = useSafeAreaInsets();
  const navBar = Platform.OS === 'android' ? insets.bottom : 0;
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const to = (keyboardHeight: number, e?: KeyboardEvent) => {
      const height = keyboardHeight > 0 ? keyboardHeight + navBar : 0;
      const duration = ios && e?.duration ? e.duration : DURATION.base;
      lift.value = withTiming(height, { duration, easing: ios ? EASE_KEYBOARD : EASE_ENTER, reduceMotion: ReduceMotion.Never });
    };
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => to(e.endCoordinates?.height ?? 0, e));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => to(0, e));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [lift, navBar]);
  return lift;
}
