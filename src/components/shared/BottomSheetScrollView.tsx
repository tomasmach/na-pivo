/**
 * The scroll side of `BottomSheetModal`. A vertical scroll view in a sheet
 * reports where it stands, so a drag on the card knows whether it scrolls the
 * content or pulls the card, and it waits for the card to decide before it
 * scrolls. Without that wait a native scroll view takes the finger the moment
 * it moves and the card's drag is cancelled halfway.
 */

import { createContext, forwardRef, useCallback, useContext, useEffect, useRef } from 'react';
import { FlatList, ScrollView, type FlatListProps, type ScrollViewInstance, type ScrollViewProps } from 'react-native';
import {
  FlatList as GestureFlatList,
  ScrollView as GestureScrollView,
  type PanGesture,
} from 'react-native-gesture-handler';

export type ScrollCount = 'scrolled' | 'scrollable';

export interface SheetScroll {
  /** Counts the scroll views in a sheet that are away from the top, and the ones with something to scroll. */
  count: (count: ScrollCount, delta: 1 | -1) => void;
  /** The card's drag; null while it is off (Reduce Motion). */
  drag: PanGesture | null;
}

export const SheetScrollContext = createContext<SheetScroll | null>(null);

type ScrollHandlers = Pick<ScrollViewProps, 'horizontal' | 'onScroll' | 'onLayout' | 'onContentSizeChange'>;

/**
 * Reports a vertical scroll view's position to the sheet around it. Returns
 * the handlers to put on the scroll view, and the drag it has to wait for
 * (`requireToFail` on a Gesture Handler scroll view); outside a sheet the
 * handlers are the ones passed in and there is nothing to wait for.
 */
export function useBottomSheetScroll({ horizontal, onScroll, onLayout, onContentSizeChange }: ScrollHandlers) {
  const sheet = useContext(SheetScrollContext);
  const count = sheet?.count;
  const state = useRef({ offset: 0, viewport: 0, content: 0, scrolled: false, scrollable: false });

  const sync = useCallback(() => {
    if (!count) return;
    const current = state.current;
    const scrolled = current.offset > 0.5;
    const scrollable = current.content > current.viewport + 0.5;
    if (scrolled !== current.scrolled) count('scrolled', scrolled ? 1 : -1);
    if (scrollable !== current.scrollable) count('scrollable', scrollable ? 1 : -1);
    current.scrolled = scrolled;
    current.scrollable = scrollable;
  }, [count]);

  useEffect(() => {
    const current = state.current;
    return () => {
      if (!count) return;
      if (current.scrolled) count('scrolled', -1);
      if (current.scrollable) count('scrollable', -1);
      current.scrolled = false;
      current.scrollable = false;
    };
  }, [count]);

  if (!sheet || horizontal) return { onScroll, onLayout, onContentSizeChange, waitFor: null };
  return {
    onScroll: ((event) => {
      state.current.offset = event.nativeEvent.contentOffset.y;
      sync();
      onScroll?.(event);
    }) satisfies ScrollViewProps['onScroll'],
    onLayout: ((event) => {
      state.current.viewport = event.nativeEvent.layout.height;
      sync();
      onLayout?.(event);
    }) satisfies ScrollViewProps['onLayout'],
    onContentSizeChange: ((width, height) => {
      state.current.content = height;
      sync();
      onContentSizeChange?.(width, height);
    }) satisfies ScrollViewProps['onContentSizeChange'],
    waitFor: sheet.drag,
  };
}

/** The `ScrollView` for a sheet's content. */
export const BottomSheetScrollView = forwardRef<ScrollViewInstance, ScrollViewProps>(function BottomSheetScrollView(
  props,
  ref,
) {
  const { waitFor, ...handlers } = useBottomSheetScroll(props);
  if (waitFor) {
    return <GestureScrollView ref={ref} scrollEventThrottle={16} {...props} {...handlers} requireToFail={waitFor} />;
  }
  return <ScrollView ref={ref} scrollEventThrottle={16} {...props} {...handlers} />;
});

/** The `FlatList` for a sheet's content. */
export function BottomSheetFlatList<ItemT>(props: FlatListProps<ItemT>) {
  const { waitFor, ...handlers } = useBottomSheetScroll(props);
  if (waitFor) {
    return <GestureFlatList scrollEventThrottle={16} {...props} {...handlers} requireToFail={waitFor} />;
  }
  return <FlatList scrollEventThrottle={16} {...props} {...handlers} />;
}
