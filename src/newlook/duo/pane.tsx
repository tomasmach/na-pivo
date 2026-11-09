import React, { useMemo } from 'react';
import { View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { WindowInsetsProvider, isBook, useLastHalf, useWindowInsets } from './layout';
import { PaneProvider, usePane, type Pane } from './paneContext';

export { PaneProvider, usePane, type Pane };

/** The width content lays out in: its half on the book, otherwise the window beside the Duo's column. */
export function usePaneWidth(): number {
  const pane = usePane();
  const { width } = useWindowDimensions();
  const insets = useWindowInsets();
  return pane?.width ?? width - insets.left - insets.right;
}

/**
 * A screen beside the iPhone Duo's side column. Screens pad only their top and
 * bottom from insets, so the whole screen is narrowed by the side insets and
 * its descendants see none, so nothing pads twice. A phone has no side insets.
 */
export function BesideColumn({ tab = null, children }: { tab?: string | null; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const windowInsets = useWindowInsets();
  const { width } = useWindowDimensions();
  const { top, bottom, left, right } = insets;
  const inner = useMemo(() => ({ top, bottom, left: 0, right: 0 }), [top, bottom]);
  const pane = useMemo<Pane>(() => ({ tab, side: 'single', width: width - left - right }), [tab, width, left, right]);
  return (
    <WindowInsetsProvider value={windowInsets}>
      <SafeAreaInsetsContext.Provider value={inner}>
        <PaneProvider value={pane}>
          <View style={{ flex: 1, marginLeft: left, marginRight: right }}>{children}</View>
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>
    </WindowInsetsProvider>
  );
}

/** How wide a screen over the tabs reads on the open book; wider lines and buttons stop reading as one column. */
export const BOOK_COLUMN = 600;

/**
 * A screen over the tabs on the open book keeps a readable column in the
 * middle of the window instead of stretching phone rows across both halves.
 */
export function BookColumn({ children }: { children: React.ReactNode }) {
  const pane = usePane();
  const width = usePaneWidth();
  const { width: windowWidth, height } = useWindowDimensions();
  // The same tree either way, so folding never remounts a half-filled screen.
  const book = isBook(windowWidth, height);
  const column = book ? Math.min(BOOK_COLUMN, width) : width;
  const value = useMemo<Pane>(() => ({ tab: pane?.tab ?? null, side: 'single', width: column }), [column, pane?.tab]);
  // The column crosses the fold, so a sheet from it opens in the half under the finger.
  const touch = book ? (e: GestureResponderEvent) => useLastHalf.getState().setHalf(e.nativeEvent.pageX < windowWidth / 2 ? 'left' : 'right') : undefined;
  return (
    <PaneProvider value={value}>
      <View style={{ flex: 1, width: column, alignSelf: 'center' }} onTouchStart={touch}>
        {children}
      </View>
    </PaneProvider>
  );
}
