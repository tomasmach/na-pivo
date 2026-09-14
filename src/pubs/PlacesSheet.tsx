/**
 * DESIGN MOCK — the draggable places sheet over a map (Packeta's places view).
 *
 * Three detents, because two is not enough and four is fiddling:
 *
 *   peek      the map is the whole screen, the sheet is parked off it
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';

/**
 * Share of the screen left ABOVE the sheet at each detent.
 *
 * Mid and expanded come from Packeta's `DraggableBottomPanel` (0.52 / 0.92 of
 * the screen HEIGHT); `peek` is deliberately shallower than theirs, because at
 * peek this sheet shows a single line of text rather than a search field and a
 * filter row. The map is the screen at that point; the sheet is a handle.
 */
export const DETENT_TOP = { peek: 1, half: 0.48, full: 0.08 } as const;
const DETENTS = DETENT_TOP;
export type Detent = keyof typeof DETENTS;

const GLASS = isLiquidGlassAvailable();

/**
 * Edge to edge, at every detent.
 *
 * It used to float inset at rest and widen as you lifted it, which is Packeta's
 * behaviour — but Packeta has no tab bar under it. Here the sheet sat 10pt off
 * each edge directly above a full-width tab bar, and the two disagreeing about
 * where the screen ends is what read as broken rather than as depth.
 */
const FLOAT_RADIUS = 34;

const SPRING = { damping: 22, stiffness: 190, mass: 0.7 } as const;

export function PlacesSheet({
  children,
  initial = 'half',
  onDetentChange,
  moveTo,
  listAtTop = true,
  scrollRef,
}: {
  children: React.ReactNode;
  initial?: Detent;
  onDetentChange?: (detent: Detent) => void;
  /** Whether the child list is scrolled to its very top. At the top a downward
   *  drag has nothing left to scroll, so it should pull the sheet down instead
   *  of doing nothing. */
  listAtTop?: boolean;
  /**
   * Programmatic move. Bump `nonce` to fire; `to` says where.
   *
   * One signal carrying its destination, rather than a boolean per detent. It
   * started as `collapseSignal` + `expandSignal` and the third case — open a
   * detail, which wants `full` — would have been a third prop and a third
   * branch in the effect below.
   */
  moveTo?: { nonce: number; to: Detent };
  /**
   * The child's scrollable.
   *
   * Without it the body pan and the list's own scrolling were two gestures
   * racing for the same finger, and the native ScrollView wins that race every
   * time — which is why dragging the list down at `full` did nothing at all.
   * `blocksExternalGesture` makes the list wait for this pan to fail first.
   */
  scrollRef?: React.RefObject<React.ComponentType<object> | null>;
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
  const [detent, setDetent] = useState<Detent>(initial);

  const settle = useCallback(
    (to: Detent) => {
      setDetent(to);
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

  // The same pan, on the body. Below `full` it owns every direction — pulling
  // the list up IS how you open the sheet. At `full` it only wakes for a
  // DOWNWARD drag, and only while the list is already at its top: there the
  // list has nothing left to scroll, so the drag belongs to the sheet.
  const atFull = detent === 'full';
  const bodyPan = Gesture.Pan()
    .enabled(!atFull || listAtTop)
    .activeOffsetY(atFull ? 8 : [-8, 8])
    .onStart(() => {
      'worklet';
      start.value = translateY.value;
    })
    .onUpdate((event) => {
      'worklet';
      const next = start.value + event.translationY;
      translateY.value = Math.min(Math.max(next, tops.full - 12), tops.peek + 12);
    })
    .onEnd((event) => {
      'worklet';
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

  const bodyGesture = scrollRef ? bodyPan.blocksExternalGesture(scrollRef) : bodyPan;

  // ONE effect owns every programmatic move. Two effects each writing the same
  // shared value is what `react-hooks/immutability` objects to, and it is right:
  // whichever ran last would win a race nobody declared.
  const seenNonce = useRef(moveTo?.nonce ?? 0);
  useEffect(() => {
    if (!moveTo || moveTo.nonce === seenNonce.current) return;
    seenNonce.current = moveTo.nonce;
    translateY.value = withSpring(tops[moveTo.to], SPRING);
    settle(moveTo.to);
  }, [moveTo, settle, tops, translateY]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    borderTopLeftRadius: FLOAT_RADIUS,
    borderTopRightRadius: FLOAT_RADIUS,
  }));

  return (
    <Animated.View style={[styles.sheet, { height }, sheetStyle]}>
      {/* Glass, like the pub cards that float over the same map. Tinted hard
          enough that a list stays readable over streets (§15.1/§15.2). */}
      {GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          tintColor={withAlpha(Colors.stout, 0.82)}
          colorScheme="dark"
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.solid]} pointerEvents="none" />
      )}
      <GestureDetector gesture={pan}>
        {/* The drag target. Tall enough to grab without aiming. */}
        <View style={styles.handleArea}>
          <View style={styles.grabber} />
        </View>
      </GestureDetector>

      {/* Below `full`, a drag anywhere on the list raises the sheet instead of
          scrolling — pulling the list up IS how you open it, and hunting for
          the grabber to see one more row is a tax. Once the sheet is up the
          gesture switches off and the list scrolls normally, so the two never
          compete for the same drag. The screen mirrors this by only enabling
          its ScrollView at `full` (see `sheetDetent`). */}
      <GestureDetector gesture={bodyGesture}>
        <View style={styles.body}>{children}</View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.12),
    overflow: 'hidden',
  },
  solid: { backgroundColor: Colors.stout },
  handleArea: { height: 22, alignItems: 'center', justifyContent: 'center' },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: withAlpha(Colors.foam, 0.26),
  },
  body: { flex: 1 },
});
