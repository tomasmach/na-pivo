/**
 * DESIGN MOCK — the draggable places sheet over a map (Packeta's places view).
 *
 * Three detents, because two is not enough and four is fiddling:
 *
 *   peek      the map is the screen, the sheet is a hint of what is nearby
 *   half      the default — map on top, the nearest few pubs under it
 *   full      the list is the screen, the map a strip you can still see
 *
 * The pan lives on the HANDLE, not on the whole sheet. Composing a pan with an
 * inner ScrollView means deciding, per gesture, whether a downward drag scrolls
 * the list or drags the sheet — and getting that wrong makes a list that fights
 * back. A grabber you drag and a list you scroll are two unambiguous controls,
 * which is worth more here than the extra polish of a unified gesture.
 *
 * No library: `react-native-gesture-handler` and `reanimated` are already
 * dependencies, and a sheet with three snap points is not worth a third.
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';
import { MockLayout } from '@/mocks/mockTheme';

/**
 * Share of the screen left ABOVE the sheet at each detent.
 *
 * Derived from Packeta's `DraggableBottomPanel` (peek 0.26 / mid 0.52 /
 * expanded 0.92 of the screen HEIGHT) so the two apps rest in the same places:
 * top = 1 − height.
 */
export const DETENT_TOP = { peek: 0.74, half: 0.48, full: 0.08 } as const;
const DETENTS = DETENT_TOP;
export type Detent = keyof typeof DETENTS;

const SPRING = { damping: 22, stiffness: 190, mass: 0.7 } as const;

export function PlacesSheet({
  children,
  initial = 'half',
  onDetentChange,
  collapseSignal = 0,
}: {
  children: React.ReactNode;
  initial?: Detent;
  onDetentChange?: (detent: Detent) => void;
  /** Bump to collapse to `peek` — Apple Maps behaviour: touching the map gets
   *  the sheet out of the way so you can see what you are touching. */
  collapseSignal?: number;
}) {
  const { height } = useWindowDimensions();
  // Precomputed pixel tops. The gesture callbacks are worklets on the UI
  // thread, so they must not call a JS closure like a `topFor(d)` helper —
  // plain numbers captured from the closure are fine, a function is not.
  const tops = useMemo(
    () => ({
      peek: Math.round(height * DETENTS.peek),
      half: Math.round(height * DETENTS.half),
      full: Math.round(height * DETENTS.full),
    }),
    [height],
  );

  const translateY = useSharedValue(Math.round(height * DETENTS[initial]));
  const start = useSharedValue(0);

  const settle = useCallback(
    (to: Detent) => {
      onDetentChange?.(to);
    },
    [onDetentChange],
  );

  const pan = Gesture.Pan()
    .onStart(() => {
      'worklet';
      start.value = translateY.value;
    })
    .onUpdate((event) => {
      'worklet';
      const next = start.value + event.translationY;
      // Clamp with a little give at both ends so it never feels stuck.
      translateY.value = Math.min(Math.max(next, tops.full - 12), tops.peek + 12);
    })
    .onEnd((event) => {
      'worklet';
      // Throw: where the sheet would land, not where the finger let go.
      const projected = translateY.value + event.velocityY * 0.12;
      const candidates: Detent[] = ['full', 'half', 'peek'];
      let best: Detent = 'half';
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        const distance = Math.abs(projected - tops[candidate]);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      translateY.value = withSpring(tops[best], SPRING);
      runOnJS(settle)(best);
    });

  // Collapse when the parent says the map was panned. The first render must
  // not fire it, or the sheet would snap to peek the moment the screen opens.
  const seenSignal = useRef(collapseSignal);
  useEffect(() => {
    if (collapseSignal === seenSignal.current) return;
    seenSignal.current = collapseSignal;
    translateY.value = withSpring(tops.peek, SPRING);
    settle('peek');
  }, [collapseSignal, settle, tops, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.sheet, { height }, sheetStyle]}>
      <GestureDetector gesture={pan}>
        {/* The drag target. Tall enough to grab without aiming. */}
        <View style={styles.handleArea}>
          <View style={styles.grabber} />
        </View>
      </GestureDetector>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: MockLayout.cardRadius + 4,
    borderTopRightRadius: MockLayout.cardRadius + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.12),
    overflow: 'hidden',
  },
  handleArea: { height: 28, alignItems: 'center', justifyContent: 'center' },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: withAlpha(Colors.foam, 0.26),
  },
  body: { flex: 1 },
});
