import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FOLD_MARGIN, useBookLayout, type BookMode } from '@/layout/bookLayout';
import { PaneContext, ToneContext, type BookTab, type PaneInfo, type PaneSide } from '@/layout/pane';
import { RightPage } from '@/layout/RightPage';
import { TabBarInsetOverride, useTabBarInset } from '@/navigation/TabScreen';
import { useBookStore } from '@/stores/bookStore';

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PaneProps {
  info: PaneInfo;
  mode: BookMode;
  /** False for a primary that spans the window: then no side of it is the fold. */
  split: boolean;
  style: StyleProp<ViewStyle>;
  pointerEvents?: 'box-none' | 'auto';
  children: ReactNode;
}

/** One half. Its insets end at the fold, and the right half speaks quietly. */
function Pane({ info, mode, split, style, pointerEvents, children }: PaneProps) {
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  // The upper half on a table ends at the fold, not at the tab bar: what covers
  // its bottom edge is the fold margin.
  const upperHalf = mode === 'tabletop' && info.side === 'secondary';
  const paneInsets = useMemo(() => {
    if (!split) return insets;
    if (mode === 'book') {
      return info.side === 'primary'
        ? { ...insets, right: FOLD_MARGIN }
        : { ...insets, left: FOLD_MARGIN };
    }
    if (mode === 'tabletop') {
      return info.side === 'primary'
        ? { ...insets, top: FOLD_MARGIN }
        : { ...insets, bottom: FOLD_MARGIN };
    }
    return insets;
  }, [info.side, insets, mode, split]);
  const tone = mode !== 'phone' && info.side === 'secondary' ? 'quiet' : 'primary';
  return (
    <View style={style} pointerEvents={pointerEvents} collapsable={false}>
      <PaneContext.Provider value={info}>
        <ToneContext.Provider value={tone}>
          <SafeAreaInsetsContext.Provider value={paneInsets}>
            <TabBarInsetOverride value={upperHalf ? FOLD_MARGIN : tabBarInset}>{children}</TabBarInsetOverride>
          </SafeAreaInsetsContext.Provider>
        </ToneContext.Provider>
      </PaneContext.Provider>
    </View>
  );
}

interface BookSpreadProps {
  tab: BookTab;
  /** The left half when the window is wide (the bottom half on a table). */
  primary: ReactNode;
  /** Its twin in the other half. Without one the primary spans the window and pages open over its right column. */
  secondary?: ReactNode;
  /** The half a phone shows. */
  phoneShows?: PaneSide;
}

const NOTHING_KEPT: Record<PaneSide, boolean> = { primary: false, secondary: false };

/**
 * A tab screen as one or two halves split on the fold. The element tree is the
 * same in every mode, so folding or unfolding never remounts a half that stays
 * on screen. A phone shows one half and unmounts the other, as before; a half
 * folded away with a sheet still open stays mounted off screen until that sheet
 * closes, so folding never throws away a draft.
 */
export function BookSpread({ tab, primary, secondary, phoneShows = 'primary' }: BookSpreadProps) {
  const { mode, foldX, foldY } = useBookLayout();
  const wide = mode !== 'phone';
  const hasSecondary = secondary !== undefined;
  const rootRef = useRef<ViewInstance>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const measure = useCallback(() => {
    rootRef.current?.measureInWindow((x, y, width, height) => {
      setFrame((current) =>
        current && current.x === x && current.y === y && current.width === width && current.height === height
          ? current
          : { x, y, width, height },
      );
    });
  }, []);
  const primaryInfo = useMemo<PaneInfo>(() => ({ tab, side: 'primary' }), [tab]);
  const secondaryInfo = useMemo<PaneInfo>(() => ({ tab, side: 'secondary' }), [tab]);
  const primaryModals = useBookStore((state) => state.openModals[`${tab}:primary`] ?? 0);
  const secondaryModals = useBookStore((state) => state.openModals[`${tab}:secondary`] ?? 0);
  const pageOpen = useBookStore((state) => state.pages[tab].length > 0);

  // Only the fold keeps a hidden half alive; on a phone a half leaves with its sheets, as before.
  const [wasWide, setWasWide] = useState(wide);
  const [foldedWithSheet, setFoldedWithSheet] = useState(NOTHING_KEPT);
  const keepPrimary = foldedWithSheet.primary && primaryModals > 0;
  const keepSecondary = foldedWithSheet.secondary && secondaryModals > 0;
  if (wasWide !== wide) {
    setWasWide(wide);
    setFoldedWithSheet(wide ? NOTHING_KEPT : { primary: primaryModals > 0, secondary: secondaryModals > 0 });
  } else if (foldedWithSheet.primary !== keepPrimary || foldedWithSheet.secondary !== keepSecondary) {
    setFoldedWithSheet({ primary: keepPrimary, secondary: keepSecondary });
  }

  // The fold relative to this view: the system tab rail may sit on either side.
  const foldInX = foldX - (frame?.x ?? 0);
  const foldInY = foldY - (frame?.y ?? 0);
  const offscreen: ViewStyle = {
    position: 'absolute',
    left: -10000,
    top: 0,
    width: frame?.width ?? 0,
    height: frame?.height ?? 0,
  };

  let primaryStyle: StyleProp<ViewStyle>;
  let secondaryStyle: StyleProp<ViewStyle>;
  let showPrimary = true;
  let showSecondary = true;
  if (mode === 'book') {
    primaryStyle = hasSecondary ? { width: foldInX } : styles.fill;
    secondaryStyle = hasSecondary ? styles.fill : [styles.overlay, { left: foldInX, bottom: 0 }];
  } else if (mode === 'tabletop') {
    primaryStyle = styles.fill;
    secondaryStyle = hasSecondary ? { height: foldInY } : [styles.overlay, { left: 0, height: foldInY }];
  } else {
    showPrimary = phoneShows === 'primary' || keepPrimary;
    showSecondary = phoneShows === 'secondary' ? hasSecondary : keepSecondary;
    primaryStyle = phoneShows === 'primary' ? styles.fill : showPrimary ? offscreen : styles.hidden;
    secondaryStyle = phoneShows === 'secondary' ? styles.fill : showSecondary ? offscreen : styles.hidden;
  }
  // A phone pushes pages as routes; the right half only lingers off screen for an open sheet.
  const showRightPage = wide || (showSecondary && phoneShows === 'primary');
  // A page covers what the half shows underneath, so VoiceOver must not reach it.
  const covered = wide && pageOpen;

  return (
    <View
      ref={rootRef}
      onLayout={measure}
      style={[styles.root, mode === 'book' && styles.row, mode === 'tabletop' && styles.columnReverse]}
      collapsable={false}
    >
      <Pane info={primaryInfo} mode={mode} split={hasSecondary} style={primaryStyle}>
        {showPrimary ? primary : null}
      </Pane>
      <Pane
        info={secondaryInfo}
        mode={mode}
        split
        style={secondaryStyle}
        pointerEvents={hasSecondary ? 'auto' : 'box-none'}
      >
        {hasSecondary ? (
          <View
            style={styles.fill}
            accessibilityElementsHidden={covered}
            importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
            collapsable={false}
          >
            {showSecondary ? secondary : null}
          </View>
        ) : null}
        {showRightPage ? <RightPage tab={tab} /> : null}
      </Pane>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { flexDirection: 'row' },
  columnReverse: { flexDirection: 'column-reverse' },
  fill: { flex: 1 },
  overlay: { position: 'absolute', top: 0, right: 0 },
  hidden: { display: 'none' },
});
