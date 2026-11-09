import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * Where a piece of UI is laid out. `single` is a whole screen (a phone, the
 * folded Duo, a screen over the tabs), `left` and `right` the halves of a tab
 * on the open book.
 */
export interface Pane {
  tab: string | null;
  side: 'single' | 'left' | 'right';
  width: number;
  /** The edge that lies on the fold of the open book, if any. */
  fold?: 'left' | 'right';
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
  const pane = usePane();
  const fold = pane?.fold ?? (pane?.side === 'left' ? 'right' : pane?.side === 'right' ? 'left' : undefined);
  const left = fold === 'left' ? 0 : inset;
  const right = fold === 'right' ? 0 : inset;
  return { style: { marginLeft: -left, marginRight: -right }, contentStyle: { paddingLeft: left, paddingRight: right } };
}

type RegisterBack = (back: (() => void) | null) => void;

const ColumnSlotContext = createContext<RegisterBack | null>(null);
/** Set by a screen beside the iPhone Duo's side column, which shows Back at the top of that column. */
export const ColumnSlotProvider = ColumnSlotContext.Provider;

/**
 * Puts this screen's Back at the top of the iPhone Duo's side column, under
 * the clock, where the system puts it. Returns true while the column shows
 * it, so the screen leaves out its own.
 */
export function useColumnBack(onBack: () => void, enabled = true): boolean {
  const register = useContext(ColumnSlotContext);
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  const active = !!register && enabled;
  useEffect(() => {
    if (!active || !register) return;
    register(() => latest.current());
    return () => register(null);
  }, [active, register]);
  return active;
}
