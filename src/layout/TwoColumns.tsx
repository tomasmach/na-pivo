import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewInstance } from 'react-native';

import { FOLD_MARGIN, useBookLayout } from '@/layout/bookLayout';
import { PaneContext, usePane, type PaneInfo } from '@/layout/pane';
import { useScreenMargins } from '@/navigation/TabScreen';
import { useBookStore } from '@/stores/bookStore';

/**
 * A long single-column screen split on the fold of a book-shaped window. On
 * anything else the wrappers lay out as if they were not there (`display:
 * contents`), so a phone keeps its exact layout and nothing remounts when the
 * window changes shape.
 *
 * The second column is the right half: sheets opened from it stay there, and
 * while a page is open over it VoiceOver does not reach it.
 */
export function TwoColumns({ first, second }: { first: ReactNode; second: ReactNode }) {
  const { mode, foldX } = useBookLayout();
  const pane = usePane();
  const ref = useRef<ViewInstance>(null);
  const [left, setLeft] = useState<number | null>(null);
  const measure = useCallback(() => {
    ref.current?.measureInWindow((x) => setLeft((current) => (current === x ? current : x)));
  }, []);
  const margins = useScreenMargins();
  useEffect(measure, [margins, measure]);
  const book = mode === 'book';
  const rightHalf = useMemo<PaneInfo | null>(() => (pane ? { tab: pane.tab, side: 'secondary' } : null), [pane]);
  const covered = useBookStore((state) => book && pane !== null && state.pages[pane.tab].length > 0);
  // The first column ends a fold margin before the fold, the second starts one after it.
  const firstWidth = left === null ? undefined : Math.max(0, foldX - FOLD_MARGIN - left);

  return (
    <View ref={ref} onLayout={measure} style={book ? styles.row : styles.contents}>
      <View style={book ? [styles.first, firstWidth === undefined ? styles.half : { width: firstWidth }] : styles.contents}>
        {first}
      </View>
      <View
        style={book ? styles.second : styles.contents}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        <PaneContext.Provider value={book ? rightHalf : pane}>{second}</PaneContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contents: { display: 'contents' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 * FOLD_MARGIN },
  first: { flexShrink: 0 },
  half: { flex: 1 },
  second: { flex: 1, minWidth: 0 },
});
