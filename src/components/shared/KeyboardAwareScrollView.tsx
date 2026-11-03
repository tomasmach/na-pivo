import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import {
  findNodeHandle,
  ScrollView,
  TextInput,
  UIManager,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type TargetedEvent,
  type ScrollViewInstance,
} from 'react-native';


import { useKeyboardHeight } from '@/utils/useKeyboardHeight';
import { Spacing } from '@/theme/layout';

interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /**
   * The parent already shrinks or lifts this scroll view above the keyboard.
   * Focused fields still scroll into the reduced viewport, but no second
   * keyboard inset is injected.
   */
  keyboardAvoidedExternally?: boolean;
}

function focusedTextInputHandle(): number | null {
  const input = TextInput.State.currentlyFocusedInput();
  if (!input) return null;
  return findNodeHandle(input) ?? null;
}

/**
 * Scroll view for every editable form in the app.
 *
 * React Native's KeyboardAvoidingView only creates space for the keyboard. It
 * does not reliably scroll the focused field into that space, particularly on
 * Android edge-to-edge and inside a native Modal. This component listens for
 * descendant focus events, adds a keyboard-sized trailing inset, and scrolls
 * the focused field above the keyboard after its animation finishes.
 */
export const KeyboardAwareScrollView = forwardRef<ScrollViewInstance, KeyboardAwareScrollViewProps>(function KeyboardAwareScrollView(
  {
    automaticallyAdjustKeyboardInsets,
    contentContainerStyle,
    keyboardAvoidedExternally = false,
    onContentSizeChange,
    onFocus,
    onLayout,
    onScroll,
    scrollEventThrottle = 16,
    ...props
  },
  forwardedRef,
) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollFocusedIntoViewRef = useRef<((onlyBelow: boolean) => void) | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const keyboardHeightRef = useRef(keyboardHeight);
  keyboardHeightRef.current = keyboardHeight;

  useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollViewInstance);

  const cancelScheduledScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    if (scrollTimerRef.current !== null) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  const handleFocus = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      onFocus?.(event);
      cancelScheduledScroll();
      // On the new architecture event.target is an element; the native tag is on nativeEvent.
      const target = event.nativeEvent.target;
      const scrollView = scrollRef.current;
      if (!scrollView || typeof target !== 'number') return;

      const scrollIntoView = (onlyBelow = false) => {
        const current = scrollRef.current;
        const scrollNode = current ? findNodeHandle(current) : null;
        const currentInputHandle = focusedTextInputHandle();
        if (!current || !scrollNode || currentInputHandle !== target) return;
        UIManager.measureLayout(
          target,
          scrollNode,
          () => undefined,
          (_x, contentY, _fieldWidth, fieldHeight) => {
            const latestInputHandle = focusedTextInputHandle();
            if (latestInputHandle !== target) return;
            const viewportHeight = viewportHeightRef.current;
            if (viewportHeight <= 0) return;
            const effectiveKeyboardHeight = keyboardAvoidedExternally
              ? 0
              : keyboardHeightRef.current;
            const keyboardTop = Math.max(
              Spacing.lg,
              viewportHeight - effectiveKeyboardHeight - Spacing.lg,
            );
            // The new architecture measures against the scroll content, not the visible part.
            const fieldY = contentY - scrollYRef.current;
            const fieldBottom = fieldY + fieldHeight;
            let deltaY = 0;
            if (fieldY < Spacing.sm && !onlyBelow) {
              deltaY = fieldY - Spacing.sm;
            } else if (fieldBottom > keyboardTop) {
              // A parent may already have lifted the view, so the keyboard top can sit
              // too high; never scroll the top of the field out of sight.
              deltaY = Math.min(fieldBottom - keyboardTop, Math.max(0, fieldY - Spacing.sm));
            } else {
              return;
            }
            if (deltaY === 0) return;

            const requestedY = Math.max(0, scrollYRef.current + deltaY);
            const contentHeight = contentHeightRef.current;
            // Keep one keyboard-height of headroom even before the content-size
            // callback catches up with the injected bottom padding. Without it,
            // the first focus during the keyboard animation could be clamped too
            // early and leave a low input hidden behind the keyboard.
            const keyboardAllowance =
              effectiveKeyboardHeight > 0
                ? effectiveKeyboardHeight + Spacing.lg
                : 0;
            const maxY =
              contentHeight > 0
                ? Math.max(0, contentHeight - viewportHeight + keyboardAllowance)
                : requestedY;
            const nextY = Math.min(requestedY, maxY);
            current.scrollTo({ y: nextY, animated: true });
          },
        );
      };
      scrollFocusedIntoViewRef.current = scrollIntoView;

      // Keyboard events and focus arrive in either order across platforms.
      // Run after layout, then once again after the native keyboard animation.
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        scrollIntoView();
      });
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        scrollIntoView();
      }, 300);
    },
    [cancelScheduledScroll, keyboardAvoidedExternally, onFocus],
  );

  // A parent that lifts this view shrinks the viewport after focus, and a
  // multiline field grows while typing; both push the focused field below the visible part.
  const followFocusedInput = useCallback(() => {
    const scrollIntoView = scrollFocusedIntoViewRef.current;
    if (!keyboardAvoidedExternally || !scrollIntoView || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      scrollIntoView(true);
    });
  }, [keyboardAvoidedExternally]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollYRef.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeightRef.current = event.nativeEvent.layout.height;
      followFocusedInput();
      onLayout?.(event);
    },
    [followFocusedInput, onLayout],
  );

  const handleContentSizeChange = useCallback(
    (width: number, height: number) => {
      contentHeightRef.current = height;
      followFocusedInput();
      onContentSizeChange?.(width, height);
    },
    [followFocusedInput, onContentSizeChange],
  );

  return (
    <ScrollView
      ref={scrollRef}
      {...props}
      onFocus={handleFocus}
      onContentSizeChange={handleContentSizeChange}
      onLayout={handleLayout}
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle}
      automaticallyAdjustKeyboardInsets={
        automaticallyAdjustKeyboardInsets ?? !keyboardAvoidedExternally
      }
      keyboardShouldPersistTaps={props.keyboardShouldPersistTaps ?? 'handled'}
      contentContainerStyle={[
        contentContainerStyle,
        keyboardHeight > 0 && !keyboardAvoidedExternally
          ? { paddingBottom: keyboardHeight + Spacing.lg }
          : null,
      ]}
    />
  );
});
