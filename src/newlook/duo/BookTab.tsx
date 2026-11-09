import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { fadeIn } from '../motion';
import { C } from '../theme';
import { DetailPageView, useDetailPages, type DetailPage } from './details';
import { useBook, useLastHalf, useRailSide, useWindowInsets } from './layout';
import { PaneProvider, usePaneWidth, type Pane } from './pane';

/**
 * A tab as one screen, or on the open book as two halves split on the fold:
 * the screen a phone shows on the left and its twin on the right. A pub,
 * beer, friend, invitation, evening or profile opened from the tab on the
 * iPhone Duo is a page of the tab: in the right half on the book, over the
 * whole tab when folded, so folding and unfolding keeps it on screen, like a
 * split view collapsing and expanding. The halves keep their place in the
 * tree, so a fold never remounts the screen under a page.
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
  const leftPane = useMemo<Pane>(
    () => (split ? { tab, side: 'left', width: leftWidth, fold: 'right' } : { tab, side: 'single', width: leftWidth }),
    [leftWidth, split, tab],
  );
  const rightPane = useMemo<Pane>(() => ({ tab, side: 'right', width: rightWidth, fold: 'left' }), [rightWidth, tab]);
  const page = pages[pages.length - 1];
  // A page covers the column beside it too, where the map under the side column would show through.
  const bleed = useRailSide() === 'right' ? insets.right : 0;
  const overLeft = !!page && !split;
  const overRight = !!page && split;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: C.bg }}>
      <View style={{ width: leftWidth }} onTouchStart={split ? () => setHalf('left') : undefined}>
        <PaneProvider value={leftPane}>
          <Covered by={overLeft}>{left}</Covered>
          {overLeft ? <PageLayer page={page} bleed={bleed} /> : null}
        </PaneProvider>
      </View>
      {split ? (
        <View style={{ width: rightWidth }} onTouchStart={() => setHalf('right')}>
          <PaneProvider value={rightPane}>
            {/* The twin stays mounted under a page, so going back does not rebuild the map. */}
            <Covered by={overRight}>{right}</Covered>
            {overRight ? <PageLayer page={page} bleed={bleed} /> : null}
          </PaneProvider>
          <View pointerEvents="none" style={styles.fold} />
        </View>
      ) : null}
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

function PageLayer({ page, bleed }: { page: DetailPage; bleed: number }) {
  return (
    <Animated.View key={page.key} entering={fadeIn} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: -bleed, backgroundColor: C.bg }}>
      <View style={{ flex: 1, marginRight: bleed }}>
        <DetailPageView page={page} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fold: { position: 'absolute', left: 0, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: C.line },
});
