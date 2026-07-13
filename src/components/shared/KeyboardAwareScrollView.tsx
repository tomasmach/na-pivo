import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import {
  findNodeHandle,
  ScrollView,
  UIManager,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type TargetedEvent,
} from 'react-native';

import { useKeyboardHeight } from '@/utils/useKeyboardHeight';
import { Spacing } from '@/theme/layout';

/**
 * Scroll view for every editable form in the app.
 *
 * React Native's KeyboardAvoidingView only creates space for the keyboard. It
 * does not reliably scroll the focused field into that space, particularly on
 * Android edge-to-edge and inside a native Modal. This component listens for
 * descendant focus events, adds a keyboard-sized trailing inset, and scrolls
 * the focused field above the keyboard after its animation finishes.
 */
export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardAwareScrollView(
  { contentContainerStyle, onFocus, onLayout, onScroll, scrollEventThrottle = 16, ...props },
  forwardedRef,
) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const keyboardHeight = useKeyboardHeight();
  const keyboardHeightRef = useRef(keyboardHeight);
  keyboardHeightRef.current = keyboardHeight;

  useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollView);

  const handleFocus = useCallback(
    (event: NativeSyntheticEvent<TargetedEvent>) => {
      onFocus?.(event);
      const target = event.target;
      const scrollView = scrollRef.current;
      if (!scrollView || typeof target !== 'number') return;

      const scrollIntoView = () => {
        const current = scrollRef.current;
        const scrollNode = current ? findNodeHandle(current) : null;
        if (!current || !scrollNode) return;
        UIManager.measureLayout(
          target,
          scrollNode,
          () => undefined,
          (_x, fieldY, _fieldWidth, fieldHeight) => {
            const viewportHeight = viewportHeightRef.current;
            if (viewportHeight <= 0) return;
            const keyboardTop = viewportHeight - keyboardHeightRef.current - Spacing.lg;
            const fieldBottom = fieldY + fieldHeight;
            if (fieldBottom <= keyboardTop && fieldY >= Spacing.sm) return;

            const nextY = Math.max(0, scrollYRef.current + fieldBottom - keyboardTop);
            current.scrollTo({ y: nextY, animated: true });
          },
        );
      };

      // Keyboard events and focus arrive in either order across platforms.
      // Run after layout, then once again after the native keyboard animation.
      requestAnimationFrame(scrollIntoView);
      setTimeout(() => {
        scrollIntoView();
      }, 300);
    },
    [onFocus],
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

  return (
    <ScrollView
      ref={scrollRef}
      {...props}
      onFocus={handleFocus}
      onLayout={handleLayout}
      onScroll={handleScroll}
      scrollEventThrottle={scrollEventThrottle}
      automaticallyAdjustKeyboardInsets={props.automaticallyAdjustKeyboardInsets ?? true}
      keyboardShouldPersistTaps={props.keyboardShouldPersistTaps ?? 'handled'}
      contentContainerStyle={[
        contentContainerStyle,
        keyboardHeight > 0 ? { paddingBottom: keyboardHeight + Spacing.lg } : null,
      ]}
    />
  );
});
