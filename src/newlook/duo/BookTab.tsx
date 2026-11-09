import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { enterTiming, exitTiming, fadeIn, fadeOutTiming } from '../motion';
import { C } from '../theme';
import { DetailPageView, useDetailPages, useDetailStore, useLeavingPages, type DetailPage } from './details';
import { useBook, useLastHalf, useRailSide, useWindowInsets } from './layout';
import { PaneProvider, usePaneWidth, type Pane } from './pane';
import { ColumnSlotProvider, useColumnSlot } from './paneContext';

/**
 * A tab as one screen, or on the open book as two halves split on the fold:
 * the screen a phone shows on the left and its twin on the right. A place
 * opened from the tab on the iPhone Duo is a page of the tab: in the right
 * half on the book, over the whole tab when folded, so folding and unfolding
 * keeps it on screen, like a split view collapsing and expanding. The halves
 * and the pages keep their place in the tree, so a fold only changes frames
 * and never remounts a screen or loses its scroll.
 */
export function BookTab({ tab, left, right }: { tab: string; left: React.ReactNode; right?: React.ReactNode }) {
  const { book, foldX } = useBook();
  const insets = useWindowInsets();
  const width = usePaneWidth();
  const setHalf = useLastHalf((st) => st.setHalf);
  const pages = useDetailPages(tab);
  const leaving = useLeavingPages(tab);
  const split = book && right !== undefined;
  // The right half of the book: the twin is passed on any Duo pose so it survives folding.
  const leftWidth = split ? Math.round(foldX - insets.left) : width;
  const rightWidth = width - leftWidth;
  const leftPane = useMemo<Pane>(
    () => (split ? { tab, side: 'left', width: leftWidth, fold: 'right' } : { tab, side: 'single', width: leftWidth }),
    [leftWidth, split, tab],
  );
  const rightPane = useMemo<Pane>(() => ({ tab, side: 'right', width: rightWidth, fold: 'left' }), [rightWidth, tab]);
  const open = pages.length > 0;
  // A page covers the column beside it too, where the map under the side column would show through.
  const bleed = useRailSide() === 'right' ? insets.right : 0;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <View style={{ width: leftWidth }} onTouchStart={split ? () => setHalf('left') : undefined}>
        <PaneProvider value={leftPane}>
          <Covered by={open && !split}>{left}</Covered>
        </PaneProvider>
      </View>
      {right !== undefined ? (
        // Folded, the twin waits hidden, so unfolding finds it as it was (the diary's month, a scroll).
        <View style={split ? { width: rightWidth } : { display: 'none' }} onTouchStart={split ? () => setHalf('right') : undefined}>
          <PaneProvider value={rightPane}>
            {/* The twin stays mounted under a page, so going back does not rebuild the map. */}
            <Covered by={open || !split}>{right}</Covered>
          </PaneProvider>
        </View>
      ) : null}
      {open || leaving.length ? (
        <View
          style={{ position: 'absolute', top: 0, bottom: 0, left: split ? leftWidth : 0, width: (split ? rightWidth : leftWidth) + bleed }}
          onTouchStart={split ? () => setHalf('right') : undefined}
        >
          <PaneProvider value={split ? rightPane : leftPane}>
            {/* A page that went back keeps its place and key while it slides out. */}
            {[...pages, ...leaving].map((page, i) => (
              <PageLayer
                key={page.key}
                tab={tab}
                page={page}
                top={i === pages.length - 1}
                leaving={i >= pages.length}
                // A selection in the book's left half replaces the right half in place, like a split view;
                // anything else comes in from the side like a navigation push, and leaves the way it came.
                slideIn={!page.shown}
                bleed={bleed}
                width={split ? rightWidth : leftWidth}
              />
            ))}
          </PaneProvider>
        </View>
      ) : null}
      {split ? <View pointerEvents="none" style={[styles.fold, { left: leftWidth }]} /> : null}
    </View>
  );
}

/** What a page covers stays mounted but out of VoiceOver's reach. */
function Covered({ by, children }: { by: boolean; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }} accessibilityElementsHidden={by} importantForAccessibility={by ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
  );
}

// How far from its leading edge a swipe back may start, like the system's edge swipe.
const EDGE = 16;
// Built once on the JS thread; the gesture's worklets only read them.
const SWIPE_OUT = exitTiming();
const SWIPE_BACK = enterTiming();
const FADE_OUT = fadeOutTiming();

/**
 * One page. Pages under the top one stay mounted, so going back finds them as
 * they were; only the top one reaches VoiceOver and the side column. A swipe
 * from its leading edge goes back, as on any iOS navigation stack.
 */
function PageLayer({
  tab,
  page,
  top,
  leaving,
  slideIn,
  bleed,
  width,
}: {
  tab: string;
  page: DetailPage;
  top: boolean;
  leaving: boolean;
  slideIn: boolean;
  bleed: number;
  width: number;
}) {
  const [from] = useState(() => (slideIn ? width + bleed : 0));
  const x = useSharedValue(from);
  const slot = useColumnSlot();
  const swipedAway = () => useDetailStore.getState().pop(tab, false);
  const forget = () => useDetailStore.getState().forget(tab, page.key);
  useEffect(() => {
    if (from) x.set(withTiming(0, SWIPE_BACK));
  }, [from, x]);
  // Back from the column or the page slides the page out the way it came, then lets it go.
  const fade = useSharedValue(1);
  useEffect(() => {
    if (!leaving) return;
    const gone = (done?: boolean) => {
      'worklet';
      if (done) runOnJS(forget)();
    };
    if (slideIn) x.set(withTiming(width + bleed, SWIPE_OUT, gone));
    else fade.set(withTiming(0, FADE_OUT, gone));
    // Runs once, when the page starts leaving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  const swipe = Gesture.Pan()
    .enabled(top)
    .hitSlop({ left: 0, width: EDGE })
    .activeOffsetX(10)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      x.set(Math.max(0, e.translationX));
    })
    .onEnd((e, success) => {
      if (success && (e.translationX > width * 0.35 || e.velocityX > 700)) {
        x.set(
          withTiming(width + bleed, SWIPE_OUT, (done) => {
            if (done) runOnJS(swipedAway)();
          }),
        );
      } else {
        x.set(withTiming(0, SWIPE_BACK));
      }
    });
  const follow = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateX: x.get() }] }));
  return (
    <GestureDetector gesture={swipe}>
      <Animated.View
        entering={slideIn ? undefined : fadeIn}
        style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }, follow]}
        accessibilityElementsHidden={!top}
        importantForAccessibility={top ? 'auto' : 'no-hide-descendants'}
        pointerEvents={top ? 'auto' : 'none'}
      >
        <View style={{ flex: 1, marginRight: bleed }}>
          {/* A page under the top one keeps its Back and actions out of the column. */}
          <ColumnSlotProvider value={top ? slot : null}>
            <DetailPageView page={page} />
          </ColumnSlotProvider>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fold: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: C.line },
});
