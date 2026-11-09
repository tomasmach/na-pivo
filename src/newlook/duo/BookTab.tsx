import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { fadeIn } from '../motion';
import { C } from '../theme';
import { DetailPageView, useDetailPages } from './details';
import { useBook, useLastHalf, useWindowInsets } from './layout';
import { PaneProvider, usePaneWidth, type Pane } from './pane';

/**
 * A tab as one screen, or on the open book as two halves split on the fold:
 * the screen a phone shows on the left and its twin on the right. A pub,
 * beer, friend or invitation opened from the tab covers the twin until you
 * go back. The left half keeps its place in the tree, so folding and
 * unfolding never remounts it.
 */
export function BookTab({ tab, left, right }: { tab: string; left: React.ReactNode; right?: React.ReactNode }) {
  const { book, foldX } = useBook();
  const insets = useWindowInsets();
  const width = usePaneWidth();
  const setHalf = useLastHalf((st) => st.setHalf);
  const pages = useDetailPages(tab);
  const split = book && right !== undefined;
  const leftWidth = split ? Math.round(foldX - insets.left) : width;
  const rightWidth = width - leftWidth;
  const leftPane = useMemo<Pane>(() => ({ tab, side: split ? 'left' : 'single', width: leftWidth }), [leftWidth, split, tab]);
  const rightPane = useMemo<Pane>(() => ({ tab, side: 'right', width: rightWidth }), [rightWidth, tab]);
  const page = pages[pages.length - 1];
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <View style={{ width: leftWidth }} onTouchStart={split ? () => setHalf('left') : undefined}>
        <PaneProvider value={leftPane}>{left}</PaneProvider>
      </View>
      {split ? (
        <View style={{ width: rightWidth }} onTouchStart={() => setHalf('right')}>
          <PaneProvider value={rightPane}>
            {/* The twin stays mounted under a page, so going back does not rebuild the map. */}
            <View style={{ flex: 1 }} accessibilityElementsHidden={!!page} importantForAccessibility={page ? 'no-hide-descendants' : 'auto'}>
              {right}
            </View>
            {page ? (
              <Animated.View key={page.key} entering={fadeIn} style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]}>
                <DetailPageView page={page} />
              </Animated.View>
            ) : null}
          </PaneProvider>
          <View pointerEvents="none" style={styles.fold} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fold: { position: 'absolute', left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: C.line },
});
