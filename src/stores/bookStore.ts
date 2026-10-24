/**
 * What the right half of a wide window shows on top of each tab: a pub, an
 * evening or a friend, stacked like pushed screens. Folding the phone hides the
 * stacks and keeps them, so the next opening shows the same page again.
 *
 * In-memory only: a restart starts with empty right halves.
 */

import { create } from 'zustand';

import type { BookTab } from '@/layout/pane';

/** The pub page's route params, in the order its openers pass them. */
export interface PubPageParams {
  key: string;
  ref?: string;
  name: string;
  lat: string;
  lng: string;
}

export type PageEntry =
  | { kind: 'pub'; params: PubPageParams }
  | { kind: 'evening'; startedAt: string }
  | { kind: 'friend'; id: string };

type Pages = Record<BookTab, PageEntry[]>;

const EMPTY_PAGES: Pages = { kompas: [], stamgast: [], parta: [], profil: [] };

/** Sheets open outside a tab: on a pushed route or hosted at the root. */
export const OUTSIDE_TABS = 'outside';

interface BookState {
  pages: Pages;
  /**
   * Visible sheets per `${tab}:${side}`, or `OUTSIDE_TABS`. A half with a sheet
   * open stays mounted while folded, and pushed routes wait for their sheets
   * before they move into a right half.
   */
  openModals: Record<string, number>;
  /** Opens a page from the tab itself, replacing whatever the right half showed. */
  show: (tab: BookTab, entry: PageEntry) => void;
  /** Opens a page from another page; back returns to it. */
  push: (tab: BookTab, entry: PageEntry) => void;
  replace: (tab: BookTab, entry: PageEntry) => void;
  back: (tab: BookTab) => void;
  clear: (tab: BookTab) => void;
  /** Empties every right half: the pages belong to the account that opened them. */
  clearAll: () => void;
  /** Moves pushed routes into the right half when the window becomes wide. */
  setPages: (tab: BookTab, entries: PageEntry[]) => void;
  modalOpened: (key: string) => void;
  modalClosed: (key: string) => void;
}

export const useBookStore = create<BookState>((set) => ({
  pages: EMPTY_PAGES,
  openModals: {},
  show: (tab, entry) => set((state) => ({ pages: { ...state.pages, [tab]: [entry] } })),
  push: (tab, entry) => set((state) => ({ pages: { ...state.pages, [tab]: [...state.pages[tab], entry] } })),
  replace: (tab, entry) =>
    set((state) => ({ pages: { ...state.pages, [tab]: [...state.pages[tab].slice(0, -1), entry] } })),
  back: (tab) => set((state) => ({ pages: { ...state.pages, [tab]: state.pages[tab].slice(0, -1) } })),
  clear: (tab) => set((state) => ({ pages: { ...state.pages, [tab]: [] } })),
  clearAll: () => set({ pages: EMPTY_PAGES }),
  setPages: (tab, entries) => set((state) => ({ pages: { ...state.pages, [tab]: entries } })),
  modalOpened: (key) =>
    set((state) => ({ openModals: { ...state.openModals, [key]: (state.openModals[key] ?? 0) + 1 } })),
  modalClosed: (key) =>
    set((state) => ({
      openModals: { ...state.openModals, [key]: Math.max(0, (state.openModals[key] ?? 0) - 1) },
    })),
}));

/** True while any sheet is open, in a tab or outside one. */
export function selectAnySheetOpen(state: Pick<BookState, 'openModals'>): boolean {
  return Object.values(state.openModals).some((count) => count > 0);
}
