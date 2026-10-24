import { useEffect, useRef } from 'react';
import { Dimensions, Platform, useWindowDimensions } from 'react-native';

/**
 * How the window is laid out. The open iPhone Duo is the only device that gets
 * the two halves: `book` is the inner display on its side (vertical fold),
 * `tabletop` the inner display upright with the bottom half flat on a table
 * (horizontal fold). Everything else, the folded Duo included, is a `phone`.
 */
export type BookMode = 'phone' | 'book' | 'tabletop';

/** Nothing tappable sits closer than this to the fold, on either side. */
export const FOLD_MARGIN = 20;

const BOOK_MIN_WIDTH = 800;
// A phone on its side is wide too, but far too short to split.
const BOOK_MIN_HEIGHT = 600;
// Between the inner display's split view (about 634 pt wide) and the open
// display upright (669 pt), so a split view stays a phone.
const TABLETOP_MIN_WIDTH = 650;
const TABLETOP_MIN_HEIGHT = 800;

/** Android keeps the phone layout until its foldables get their own design. */
export function bookModeFor(width: number, height: number, platform: string = Platform.OS): BookMode {
  if (platform !== 'ios') return 'phone';
  if (width >= BOOK_MIN_WIDTH && height >= BOOK_MIN_HEIGHT && width > height) return 'book';
  if (width >= TABLETOP_MIN_WIDTH && height >= TABLETOP_MIN_HEIGHT) return 'tabletop';
  return 'phone';
}

export interface BookLayout {
  mode: BookMode;
  wide: boolean;
  /** The fold in window coordinates. iOS has no public hinge position, so it is the window's centre. */
  foldX: number;
  foldY: number;
}

export function useBookLayout(): BookLayout {
  const { width, height } = useWindowDimensions();
  const mode = bookModeFor(width, height);
  return { mode, wide: mode !== 'phone', foldX: width / 2, foldY: height / 2 };
}

/** The mode for code outside React (navigation helpers). */
export function currentBookMode(): BookMode {
  const { width, height } = Dimensions.get('window');
  return bookModeFor(width, height);
}

/**
 * Runs when the window becomes wide, including a first render that is already
 * wide. Screens point their phone state back at the left half here, so folding
 * always lands on the compass or the counter without a remount in between.
 */
export function useOnBookOpen(callback: () => void): void {
  const { wide } = useBookLayout();
  const callbackRef = useRef(callback);
  const wasWide = useRef(false);
  useEffect(() => {
    callbackRef.current = callback;
  });
  useEffect(() => {
    if (wide && !wasWide.current) callbackRef.current();
    wasWide.current = wide;
  }, [wide]);
}
