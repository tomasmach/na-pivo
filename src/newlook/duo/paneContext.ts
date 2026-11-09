import { createContext, useContext, useEffect, useRef } from 'react';

import type { IconName } from '../components/Icon';

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

export interface ColumnAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  /** The label in the overflow sheet when the column has no room for the button. */
  menuLabel?: string;
}

export interface ColumnBackItem {
  onPress: () => void;
  icon: 'chevron-left' | 'x';
}

export interface ColumnSlot {
  setBack: (back: ColumnBackItem | null) => void;
  setActions: (actions: ColumnAction[] | null) => void;
}

const ColumnSlotContext = createContext<ColumnSlot | null>(null);
/** Set by a screen beside the iPhone Duo's side column, which shows Back and the screen's actions in that column. */
export const ColumnSlotProvider = ColumnSlotContext.Provider;

export function useColumnSlot(): ColumnSlot | null {
  return useContext(ColumnSlotContext);
}

/**
 * Puts this screen's Back (or Close) at the top of the iPhone Duo's side
 * column, under the clock, where the system's toolbar puts it. Returns true
 * while the column shows it, so the screen leaves out its own.
 */
export function useColumnBack(onBack: () => void, enabled = true, icon: ColumnBackItem['icon'] = 'chevron-left'): boolean {
  const slot = useContext(ColumnSlotContext);
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });
  const active = !!slot && enabled;
  useEffect(() => {
    if (!active || !slot) return;
    slot.setBack({ onPress: () => latest.current(), icon });
    return () => slot.setBack(null);
  }, [active, icon, slot]);
  return active;
}

/**
 * Puts a page's icon actions (share, favourite, more, …) into the side column
 * under its Back, as the iPhone Duo's toolbar does. Returns true while the
 * column shows them.
 */
export function useColumnActions(actions: ColumnAction[]): boolean {
  const slot = useContext(ColumnSlotContext);
  const active = !!slot && actions.length > 0;
  // Actions are rebuilt every render; the column takes them when what they show changes.
  const signature = actions.map((a) => `${a.icon}|${a.label}|${a.color ?? ''}`).join(',');
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  useEffect(() => {
    if (!active || !slot) return;
    slot.setActions(latest.current.map((action, i) => ({ ...action, onPress: () => latest.current[i]?.onPress() })));
    return () => slot.setActions(null);
  }, [active, signature, slot]);
  return active;
}
