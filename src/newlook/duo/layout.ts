import { createContext, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

/**
 * The iPhone Duo puts its status bar, camera and the app's bars in a column on
 * one side of the window (84 pt, folded or open as a book). A side inset this
 * big is that column; a phone's side insets are zero.
 */
const RAIL_MIN_INSET = 60;

// A phone on its side is wide too, but far too short to split.
const BOOK_MIN_WIDTH = 800;
const BOOK_MIN_HEIGHT = 600;

export type RailSide = 'left' | 'right';

/** Where the tab bar stands up, or null where it lies along the bottom. Android keeps the phone layout. */
export function railSideFor(insets: Pick<EdgeInsets, 'left' | 'right'>, platform: string = Platform.OS): RailSide | null {
  if (platform !== 'ios') return null;
  if (insets.right >= RAIL_MIN_INSET && insets.right >= insets.left) return 'right';
  if (insets.left >= RAIL_MIN_INSET) return 'left';
  return null;
}

/** The open iPhone Duo held as a book: two halves split on the fold. */
export function isBook(width: number, height: number, platform: string = Platform.OS): boolean {
  return platform === 'ios' && width >= BOOK_MIN_WIDTH && height >= BOOK_MIN_HEIGHT && width > height;
}

/** Window insets, before a screen narrows its descendants to the content beside the column. */
const WindowInsetsContext = createContext<EdgeInsets | null>(null);
export const WindowInsetsProvider = WindowInsetsContext.Provider;

export function useWindowInsets(): EdgeInsets {
  const insets = useSafeAreaInsets();
  return useContext(WindowInsetsContext) ?? insets;
}

export function useRailSide(): RailSide | null {
  return railSideFor(useWindowInsets());
}

/**
 * The window split on the fold. iOS gives apps no hinge position, but the fold
 * of the inner display is its middle. `foldX` is in window coordinates.
 */
export function useBook(): { book: boolean; foldX: number; width: number; height: number } {
  const { width, height } = useWindowDimensions();
  return { book: isBook(width, height), foldX: width / 2, width, height };
}

export type Half = 'left' | 'right';

/**
 * The half a person touched last on the open book. A sheet, dialog or toast
 * opens in it, so nothing lies across the fold and it comes up where the
 * finger already is.
 */
export const useLastHalf = create<{ half: Half; setHalf: (half: Half) => void }>((set) => ({
  half: 'left',
  setHalf: (half) => set((st) => (st.half === half ? st : { half })),
}));

/** The frame of a window-wide overlay: the window beside the side column, or on a book the half last touched. */
export function useOverlayFrame(fixedHalf?: Half): { left: number; width: number; book: boolean } {
  const { book, foldX, width } = useBook();
  const insets = useWindowInsets();
  const lastHalf = useLastHalf((st) => st.half);
  const half = fixedHalf ?? lastHalf;
  if (book) {
    return half === 'left'
      ? { left: insets.left, width: foldX - insets.left, book }
      : { left: foldX, width: width - foldX - insets.right, book };
  }
  return { left: insets.left, width: width - insets.left - insets.right, book };
}
