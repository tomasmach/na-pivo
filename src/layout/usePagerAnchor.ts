import { useLayoutEffect, useRef, type RefObject } from 'react';

interface OffsetScrollable {
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
}

/**
 * Keeps a full-width paged list on its page when the window width changes
 * (folding or unfolding the iPhone Duo). The page width changes but the scroll
 * offset does not, which would leave the pager half a page off.
 */
export function usePagerAnchor(
  listRef: RefObject<OffsetScrollable | null>,
  indexRef: RefObject<number>,
  width: number,
): void {
  const lastWidth = useRef(width);
  useLayoutEffect(() => {
    if (lastWidth.current === width) return;
    lastWidth.current = width;
    listRef.current?.scrollToOffset({ offset: indexRef.current * width, animated: false });
  }, [indexRef, listRef, width]);
}
