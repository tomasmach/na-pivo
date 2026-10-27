/**
 * A sheet from the bottom edge (§7.2b). It renders the app's `Modal`, so all it
 * does for an open iPhone Duo still holds, and adds the motion:
 *
 * - `Modal` itself does not animate. The dimming fades in while the card rides
 *   up on a spring with a light overshoot; closing runs both in reverse, and
 *   the modal stays mounted until the card is gone.
 * - The card is the only child, laid out against the whole frame, and its own
 *   top edge sets how far it travels. A drag anywhere on it pulls it down;
 *   past a quarter of that travel or on a fast flick it closes through
 *   `onClose`, like the close button. Pulled up, it follows a quarter of the
 *   finger and `underlayColor` fills the strip below it.
 * - A vertical scroll view inside is a `BottomSheetScrollView` (or the
 *   `KeyboardAwareScrollView`): a downward drag scrolls until its content is at
 *   the top, and only then pulls the card; an upward one scrolls whenever
 *   there is something to scroll. The card decides within a few points, and
 *   the scroll view waits for it.
 * - Closing fits in the 260 ms a sheet-after-sheet waits for (§7.4).
 * - Reduce Motion leaves only the modal's own fade, without the drag.
 */

import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ColorValue,
  type LayoutChangeEvent,
} from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  GestureStateManager,
  State,
  usePanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { SheetScrollContext, type ScrollCount } from '@/components/shared/BottomSheetScrollView';
import { Modal } from '@/components/shared/Modal';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { fireSoftImpactHaptic } from '@/utils/haptics';

const DEFAULT_SCRIM = withAlpha(Colors.black, 0.6);

const FADE_IN_MS = 220;
// Reanimated defaults to a mass of 4; the tuning assumes 1.
const OPEN_SPRING = { mass: 1, stiffness: 260, damping: 26 };
/** The open spring first reaches the resting place after about this long; the card lands there. */
const LANDING_MS = 260;
const LEAVE_MS = 200;
/** How long a drag that closed the sheet waits for its host to agree before the card returns. */
const DECLINE_MS = 120;
const FLICK_SPRING = { mass: 1, stiffness: 300, damping: 34, overshootClamping: true };

const DRAG_SLOP = 6;
const CLOSE_FRACTION = 0.25;
const CLOSE_VELOCITY = 900;
const PULL_UP_RESISTANCE = 0.25;

export interface BottomSheetModalProps {
  visible: boolean;
  /** A tap on the dimming, Android back, the VoiceOver escape and a drag past the threshold all ask here. */
  onClose: () => void;
  /** After the card has left and the modal is gone. A sheet its parent unmounts on close hands that over here. */
  onClosed?: () => void;
  scrimColor?: ColorValue;
  /** The card's colour, for a card flush with the bottom edge: it fills the strip a pull up uncovers. */
  underlayColor?: ColorValue;
  navigationBarTranslucent?: boolean;
  /** Drawn over the sheet and outside its motion, such as a toast. */
  overlay?: ReactNode;
  children: ReactElement<{ onLayout?: (event: LayoutChangeEvent) => void }>;
}

function softTap() {
  if (useSettingsStore.getState().hapticEnabled) fireSoftImpactHaptic();
}

export function BottomSheetModal({
  visible,
  onClose,
  onClosed,
  scrimColor = DEFAULT_SCRIM,
  underlayColor,
  navigationBarTranslucent,
  overlay,
  children,
}: BottomSheetModalProps) {
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  const [shown, setShown] = useState(visible);
  if (visible && !shown) setShown(true);
  // A card that never laid out has nowhere to leave from, so the modal goes with `visible`.
  const [laidOut, setLaidOut] = useState(false);

  const offset = useSharedValue(windowHeight);
  const fade = useSharedValue(0);
  const landing = useSharedValue(0);
  const travel = useSharedValue(0);
  const dragFrom = useSharedValue(0);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const scrolled = useSharedValue(0);
  const scrollable = useSharedValue(0);

  // The JS side's own bookkeeping: a shared value read back on this thread can lag behind its last write.
  const state = useRef({
    sheetHeight: 0,
    cardTop: -1,
    wanted: false,
    pending: false,
    leaving: false,
    flick: 0,
    scrolled: 0,
    scrollable: 0,
  });

  const countScroll = useCallback(
    (count: ScrollCount, delta: 1 | -1) => {
      const current = state.current;
      current[count] += delta;
      (count === 'scrolled' ? scrolled : scrollable).set(current[count] > 0 ? 1 : 0);
    },
    [scrollable, scrolled],
  );

  const land = useCallback(() => {
    landing.set(0);
    landing.set(
      withTiming(1, { duration: LANDING_MS }, (finished) => {
        'worklet';
        if (finished) runOnJS(softTap)();
      }),
    );
  }, [landing]);

  const open = useCallback(() => {
    const current = state.current;
    if (!current.pending || current.sheetHeight <= 0 || current.cardTop < 0) return;
    current.pending = false;
    cancelAnimation(offset);
    // Reopened while leaving, the card turns back from where it is.
    if (!current.leaving) offset.set(Math.max(current.sheetHeight - current.cardTop, 1));
    current.leaving = false;
    offset.set(withSpring(0, OPEN_SPRING));
    fade.set(withTiming(1, { duration: FADE_IN_MS }));
    land();
  }, [fade, land, offset]);

  const finishClose = useCallback(() => {
    const current = state.current;
    current.sheetHeight = 0;
    current.cardTop = -1;
    setLaidOut(false);
    current.leaving = false;
    offset.set(windowHeight);
    setShown(false);
    onClosed?.();
  }, [offset, onClosed, windowHeight]);

  const close = useCallback(() => {
    const current = state.current;
    current.pending = false;
    cancelAnimation(landing);
    const velocity = current.flick;
    current.flick = 0;
    if (current.sheetHeight <= 0 || current.cardTop < 0) {
      setTimeout(finishClose, 0);
      return;
    }
    current.leaving = true;
    const distance = Math.max(current.sheetHeight - current.cardTop, 1);
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(finishClose)();
    };
    fade.set(withTiming(0, { duration: LEAVE_MS }));
    offset.set(
      velocity > 0
        ? withSpring(distance, { ...FLICK_SPRING, velocity }, done)
        : withTiming(distance, { duration: LEAVE_MS, easing: Easing.in(Easing.cubic) }, done),
    );
  }, [fade, finishClose, landing, offset]);

  const settle = useCallback(
    (velocity: number) => {
      'worklet';
      offset.set(withSpring(0, { ...OPEN_SPRING, velocity }));
      fade.set(withTiming(1, { duration: FADE_IN_MS }));
    },
    [fade, offset],
  );

  useEffect(() => {
    const current = state.current;
    const was = current.wanted;
    current.wanted = visible;
    if (was === visible) return;
    if (reduceMotion) {
      if (visible) softTap();
      else onClosed?.();
    } else if (visible) {
      current.pending = true;
      open();
    } else {
      close();
    }
    // Only a change of `visible` moves the card; new callbacks do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const dismissByDrag = useCallback(
    (velocity: number) => {
      softTap();
      state.current.flick = velocity;
      onClose();
      // A host that keeps the sheet open (a draft to confirm first) gets the card back.
      setTimeout(() => {
        if (!state.current.wanted) return;
        state.current.flick = 0;
        settle(0);
      }, DECLINE_MS);
    },
    [onClose, settle],
  );

  const measure = useCallback(() => {
    const current = state.current;
    if (current.sheetHeight > 0 && current.cardTop >= 0) travel.set(Math.max(current.sheetHeight - current.cardTop, 1));
    open();
  }, [open, travel]);

  const measureSheet = useCallback(
    (event: LayoutChangeEvent) => {
      state.current.sheetHeight = event.nativeEvent.layout.height;
      measure();
    },
    [measure],
  );

  const ownCardLayout = children.props.onLayout;
  const measureCard = useCallback(
    (event: LayoutChangeEvent) => {
      state.current.cardTop = event.nativeEvent.layout.y;
      setLaidOut(true);
      measure();
      ownCardLayout?.(event);
    },
    [measure, ownCardLayout],
  );

  const pan = usePanGesture({
    enabled: visible && !reduceMotion,
    manualActivation: true,
    onTouchesDown: (event) => {
      'worklet';
      const touch = event.allTouches[0];
      if (!touch) return;
      touchX.set(touch.absoluteX);
      touchY.set(touch.absoluteY);
    },
    onTouchesMove: (event) => {
      'worklet';
      const touch = event.allTouches[0];
      if (!touch || event.state === State.ACTIVE) return;
      if (event.numberOfTouches > 1) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      const dx = touch.absoluteX - touchX.get();
      const dy = touch.absoluteY - touchY.get();
      if (Math.abs(dx) > DRAG_SLOP && Math.abs(dx) > Math.abs(dy)) {
        GestureStateManager.fail(event.handlerTag);
      } else if (dy > DRAG_SLOP) {
        if (scrolled.get() > 0) GestureStateManager.fail(event.handlerTag);
        else GestureStateManager.activate(event.handlerTag);
      } else if (dy < -DRAG_SLOP) {
        if (scrollable.get() > 0) GestureStateManager.fail(event.handlerTag);
        else GestureStateManager.activate(event.handlerTag);
      }
    },
    onActivate: () => {
      'worklet';
      cancelAnimation(offset);
      dragFrom.set(offset.get());
    },
    onUpdate: (event) => {
      'worklet';
      const next = dragFrom.get() + event.translationY;
      const y = next < 0 ? next * PULL_UP_RESISTANCE : next;
      offset.set(y);
      fade.set(1 - Math.min(Math.max(y / travel.get(), 0), 1));
    },
    onDeactivate: (event) => {
      'worklet';
      if (offset.get() > travel.get() * CLOSE_FRACTION || event.velocityY > CLOSE_VELOCITY) {
        runOnJS(dismissByDrag)(Math.max(event.velocityY, 0));
      } else {
        settle(event.velocityY);
      }
    },
  });

  const sheetScroll = useMemo(() => ({ count: countScroll, drag: reduceMotion ? null : pan }), [countScroll, pan, reduceMotion]);

  const scrimMotion = useAnimatedStyle(() => ({ opacity: fade.value }));
  const cardMotion = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));

  return (
    <Modal
      visible={reduceMotion || !laidOut ? visible : shown}
      transparent
      animationType={reduceMotion ? 'fade' : 'none'}
      statusBarTranslucent
      navigationBarTranslucent={navigationBarTranslucent}
      presentationStyle="overFullScreen"
      scrimColor={scrimColor}
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.scrim, { backgroundColor: scrimColor }, !reduceMotion && scrimMotion]}>
          {/* Hidden from screen readers: the sheet's own close button says "Zavřít" once. */}
          <Pressable
            style={styles.fill}
            onPress={onClose}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </Animated.View>
        <SheetScrollContext.Provider value={sheetScroll}>
          <GestureDetector gesture={pan}>
            <Animated.View
              style={[styles.sheet, !reduceMotion && cardMotion]}
              pointerEvents="box-none"
              onLayout={measureSheet}
              accessibilityViewIsModal
              onAccessibilityEscape={onClose}
            >
              {underlayColor ? (
                <View pointerEvents="none" style={[styles.underlay, { backgroundColor: underlayColor }]} />
              ) : null}
              {/* The handler reads its refs only when a layout arrives, never while rendering. */}
              {/* eslint-disable-next-line react-hooks/refs */}
              {cloneElement(children, { onLayout: measureCard })}
            </Animated.View>
          </GestureDetector>
        </SheetScrollContext.Provider>
        {overlay}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill },
  sheet: { flex: 1, justifyContent: 'flex-end' },
  underlay: { position: 'absolute', left: 0, right: 0, top: '100%', height: '100%' },
});
