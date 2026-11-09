import React, { useMemo, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';

import { nvBack } from '../navigation';
import { C } from '../theme';
import { ColumnToolbar } from './ColumnToolbar';
import { WindowInsetsProvider, isBook, railSideFor, useLastHalf, useWindowInsets } from './layout';
import { ColumnSlotProvider, PaneProvider, usePane, type ColumnAction, type ColumnBackItem, type ColumnSlot, type Pane } from './paneContext';

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
 * its descendants see none, so nothing pads twice. A screen with Back gets it
 * at the top of the column. A phone has no side insets and no column.
 */
export function BesideColumn({ tab = null, children }: { tab?: string | null; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const windowInsets = useWindowInsets();
  const { width } = useWindowDimensions();
  const { top, bottom, left, right } = insets;
  const rail = railSideFor(insets);
  const inner = useMemo(() => ({ top, bottom, left: 0, right: 0 }), [top, bottom]);
  const pane = useMemo<Pane>(() => ({ tab, side: 'single', width: width - left - right }), [tab, width, left, right]);
  const [back, setBack] = useState<ColumnBackItem | null>(null);
  const [actions, setActions] = useState<ColumnAction[] | null>(null);
  const slot = useMemo<ColumnSlot>(() => ({ setBack, setActions }), []);
  return (
    <WindowInsetsProvider value={windowInsets}>
      <SafeAreaInsetsContext.Provider value={inner}>
        <PaneProvider value={pane}>
          <ColumnSlotProvider value={rail ? slot : null}>
            <View style={{ flex: 1 }}>
              <View style={{ flex: 1, marginLeft: left, marginRight: right }}>{children}</View>
              {rail && (back || actions?.length) ? <ColumnToolbar side={rail} back={back} actions={actions ?? []} besideTabs={tab !== null} /> : null}
            </View>
          </ColumnSlotProvider>
        </PaneProvider>
      </SafeAreaInsetsContext.Provider>
    </WindowInsetsProvider>
  );
}

/**
 * A screen over the tabs. On the open book it takes the right half, like a
 * split view's second column, so nothing of it lies on the fold; the left half
 * dims the tabs under it and a tap there goes back. Elsewhere it is the whole
 * screen. The tree is the same either way, so folding never remounts it.
 */
export function BookPanel({ dismissable = true, children }: { dismissable?: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const pane = usePane();
  const width = usePaneWidth();
  const insets = useWindowInsets();
  const { width: windowWidth, height } = useWindowDimensions();
  const book = isBook(windowWidth, height);
  const rail = railSideFor(insets);
  const leftWidth = book ? Math.round(windowWidth / 2 - insets.left) : 0;
  const panelWidth = width - leftWidth;
  // The only screen in the window keeps its yellow button, so it is not a quiet right half.
  const value = useMemo<Pane>(
    () => ({ tab: pane?.tab ?? null, side: 'single', width: panelWidth, fold: book ? 'left' : undefined }),
    [book, panelWidth, pane?.tab],
  );
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <Pressable
        style={{ width: leftWidth, backgroundColor: C.scrim }}
        disabled={!book || !dismissable}
        onPress={() => nvBack(router)}
        accessibilityRole="button"
        accessibilityLabel={t.nv.profil.chrome.back}
        accessibilityElementsHidden={!book}
        importantForAccessibility={book ? 'auto' : 'no-hide-descendants'}
      />
      <View style={{ width: panelWidth, backgroundColor: C.bg }} onTouchStart={book ? () => useLastHalf.getState().setHalf('right') : undefined}>
        <PaneProvider value={value}>{children}</PaneProvider>
      </View>
      {/* The tab bar under the panel cannot be reached: on the book it dims with the tabs, folded the
          panel covers it like any pushed screen. Back stays above either. */}
      {rail === 'right' ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, bottom: 0, right: -insets.right, width: insets.right, backgroundColor: book ? C.scrim : C.bg }}
        />
      ) : null}
    </View>
  );
}
