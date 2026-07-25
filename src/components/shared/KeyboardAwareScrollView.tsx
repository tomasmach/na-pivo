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
  // React Native's public TextInput state returns a Fabric host instance while
  // findNodeHandle still exposes its legacy component-shaped TypeScript input.
  return findNodeHandle(input as unknown as Parameters<typeof findNodeHandle>[0]);
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
export const KeyboardAwareScrollView = forwardRef<ScrollView, KeyboardAwareScrollViewProps>(function KeyboardAwareScrollView(
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
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const keyboardHeightRef = useRef(keyboardHeight);
  keyboardHeightRef.current = keyboardHeight;

  useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollView);

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
      const target = event.target;
      const scrollView = scrollRef.current;
      if (!scrollView || typeof target !== 'number') return;

      const scrollIntoView = () => {
        const current = scrollRef.current;
        const scrollNode = current ? findNodeHandle(current) : null;
        const currentInputHandle = focusedTextInputHandle();
        if (!current || !scrollNode || currentInputHandle !== target) return;
        UIManager.measureLayout(
          target,
          scrollNode,
          () => undefined,
          (_x, fieldY, _fieldWidth, fieldHeight) => {
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
            const fieldBottom = fieldY + fieldHeight;
            let deltaY = 0;
            if (fieldY < Spacing.sm) {
              deltaY = fieldY - Spacing.sm;
            } else if (fieldBottom > keyboardTop) {
              deltaY = fieldBottom - keyboardTop;
            } else {
              return;
            }

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
      onLayout?.(event);
    },
    [onLayout],
  );

  const handleContentSizeChange = useCallback(
    (width: number, height: number) => {
      contentHeightRef.current = height;
      onContentSizeChange?.(width, height);
    },
    [onContentSizeChange],
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
