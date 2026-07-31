/**
 * DESIGN MOCK — one element growing into the screen it opens.
 *
 * Two shapes, one mechanism:
 *
 *   disc  the Party button — an amber circle from the tab bar
 *   rect  a feed card — the card's own frame, corners and colour
 *
 * There is no native way to do this here. `react-native-screens` 4.25 offers
 * only fade / flip / slide / ios_from_* — no zoom-from-source-view — and
 * Reanimated 4 dropped shared element transitions (the `sharedTransitionTag`
 * types survive, the implementation does not). So it is hand-rolled, which is
 * also the version that will not break on the next upgrade.
 *
 * The trick is the same either way: the source's frame grows until it covers
 * the screen, the route is pushed at the moment the cover is opaque, and the
 * cover then fades to reveal the destination. Because the hand-off happens
 * behind an opaque surface, the push is invisible — what you see is the thing
 * you tapped becoming the screen.
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

const GROW_MS = 230;
const FADE_MS = 160;

export interface MorphSource {
  /** The source's frame in screen coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius to start from; it flattens as the shape fills the screen. */
  radius: number;
  /** Surface colour, so the cover reads as the element itself growing. */
  color: string;
}

interface MorphState {
  source: MorphSource | null;
  onCovered: (() => void) | null;
  fire: (source: MorphSource, onCovered: () => void) => void;
  clear: () => void;
}

export const usePartyMorph = create<MorphState>((set) => ({
  source: null,
  onCovered: null,
  fire: (source, onCovered) => set({ source, onCovered }),
  clear: () => set({ source: null, onCovered: null }),
}));

/** The Party button's amber medallion, as a source. */
export function discSource(centre: { x: number; y: number }): MorphSource {
  const SIZE = 40;
  return {
    x: centre.x - SIZE / 2,
    y: centre.y - SIZE / 2,
    width: SIZE,
    height: SIZE,
    radius: SIZE / 2,
    color: Colors.amber,
  };
}

export function PartyMorph() {
  const { width, height } = useWindowDimensions();
  // Only `source` is subscribed. The callbacks are read imperatively inside the
  // effect — writing them to refs during render is the thing `react-hooks/refs`
  // flags, and zustand hands them over without either problem.
  const source = usePartyMorph((s) => s.source);

  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);

  // The whole chain lives in one effect. Splitting the fade into a separate
  // callback meant mutating shared values the effect also reads, which the
  // immutability rule flags — and it is right: two owners of one animation.
  React.useEffect(() => {
    if (!source) return;

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
  }, [source, opacity, progress]);

  // Interpolating the FRAME rather than scaling keeps the corners the right
  // size the whole way — a scaled-up rounded rect blows its radius up with it
  // and reads as a zoom of a picture, not as the card unfolding.
  const style = useAnimatedStyle(() => {
    if (!source) return { opacity: 0 };
    const t = progress.value;
    return {
      opacity: opacity.value,
      left: source.x * (1 - t),
      top: source.y * (1 - t),
      width: source.width + (width - source.width) * t,
      height: source.height + (height - source.height) * t,
      borderRadius: source.radius * (1 - t),
    };
  });

  if (!source) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.cover, { backgroundColor: source.color }, style]}
    />
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', zIndex: 999 },
});
