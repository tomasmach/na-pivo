/**
 * DESIGN MOCK — the Party button morphing into the night.
 *
 * There is no native way to do this here. `react-native-screens` 4.25 offers
 * only fade / flip / slide / ios_from_* — no zoom-from-source-view — and
 * Reanimated 4 dropped shared element transitions (the `sharedTransitionTag`
 * types survive, the implementation does not). So this is hand-rolled, which
 * is also the only version that will not break on the next upgrade.
 *
 * The trick is deliberately simple: an amber disc starts exactly where the
 * Party button is, grows until it covers the screen, and the modal is pushed at
 * the moment the screen is fully amber. The disc then fades, revealing the
 * night underneath. Because the cover is opaque at the hand-off, the push is
 * invisible — what you see is the button becoming the screen.
 *
 * Timing is short on purpose (§10 allows one pop as a reaction to a tap, not a
 * flourish). The whole thing is under 400 ms and never loops.
 */

import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { create } from 'zustand';

import { Colors } from '@/theme/colors';

/** The disc's starting diameter — the Party button's amber medallion. */
const SEED = 40;
const GROW_MS = 210;
const FADE_MS = 160;

interface MorphState {
  /** Centre of the Party button, in screen coordinates. */
  origin: { x: number; y: number } | null;
  /** What to run once the screen is fully covered. */
  onCovered: (() => void) | null;
  fire: (origin: { x: number; y: number }, onCovered: () => void) => void;
  clear: () => void;
}

export const usePartyMorph = create<MorphState>((set) => ({
  origin: null,
  onCovered: null,
  fire: (origin, onCovered) => set({ origin, onCovered }),
  clear: () => set({ origin: null, onCovered: null }),
}));

export function PartyMorph() {
  const { width, height } = useWindowDimensions();
  // Only `origin` is subscribed. The callbacks are read imperatively inside the
  // effect — writing them to refs during render is the thing `react-hooks/refs`
  // flags, and zustand hands them over without either problem.
  const origin = usePartyMorph((s) => s.origin);

  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);

  // Far corner distance × 2 / SEED — the scale at which the disc certainly
  // covers every pixel from wherever the button happens to be.
  const scale = origin
    ? (Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y)) * 2) /
      SEED
    : 1;

  // The whole chain lives in one effect. Splitting the fade into a separate
  // callback meant mutating shared values the effect also reads, which the
  // immutability rule flags — and it is right: two owners of one animation.
  React.useEffect(() => {
    if (!origin) return;

    const cover = () => {
      const { onCovered, clear } = usePartyMorph.getState();
      onCovered?.();
      opacity.value = withTiming(0, { duration: FADE_MS }, (done) => {
        if (done) runOnJS(clear)();
      });
    };

    progress.value = 0;
    opacity.value = 1;
    progress.value = withTiming(
      1,
      { duration: GROW_MS, easing: Easing.out(Easing.cubic) },
      (done) => {
        if (done) runOnJS(cover)();
      },
    );
  }, [origin, opacity, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: 1 + progress.value * (scale - 1) }],
  }));

  if (!origin) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.disc,
        {
          left: origin.x - SEED / 2,
          top: origin.y - SEED / 2,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  disc: {
    position: 'absolute',
    width: SEED,
    height: SEED,
    borderRadius: SEED / 2,
    backgroundColor: Colors.amber,
    zIndex: 999,
  },
});
