import { createContext, useContext } from 'react';

/**
 * Where a piece of UI is laid out. `single` is a whole screen (a phone, the
 * folded Duo, a screen over the tabs), `left` and `right` the halves of a tab
 * on the open book.
 */
export interface Pane {
  tab: string | null;
  side: 'single' | 'left' | 'right';
  width: number;
}

const PaneContext = createContext<Pane | null>(null);
export const PaneProvider = PaneContext.Provider;

export function usePane(): Pane | null {
  return useContext(PaneContext);
}

/**
 * Margins and padding for a row that scrolls sideways out to the screen's
 * edges. On the open book it stops at the content edge on the fold's side, so
 * nothing you can tap scrolls into the 20 pt beside the fold.
 */
export function useEdgeBleed(inset: number): {
  style: { marginLeft: number; marginRight: number };
  contentStyle: { paddingLeft: number; paddingRight: number };
} {
  const side = usePane()?.side;
  const left = side === 'right' ? 0 : inset;
  const right = side === 'left' ? 0 : inset;
  return { style: { marginLeft: -left, marginRight: -right }, contentStyle: { paddingLeft: left, paddingRight: right } };
}
