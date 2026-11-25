import { create } from 'zustand';

import { useAccountStore } from '@/stores/accountStore';

export type DetailRoute =
  | 'hospoda'
  | 'pivo'
  | 'kamos'
  | 'plan'
  | 'vecer'
  | 'profil'
  | 'nastaveni'
  | 'odznaky'
  | 'pivni-fotky'
  | 'moje-hospody'
  | 'hlidana-piva'
  | 'ohodnocena-piva'
  | 'fotopivar'
  | 'tour'
  | 'cisla'
  | 'pivo-u-nekoho'
  | 'moje-setkani'
  | 'zebricky';

/** Pages that stand for a route with an id in its path. */
const WITH_ID: ReadonlySet<DetailRoute> = new Set(['hospoda', 'pivo', 'kamos', 'plan', 'vecer']);

export interface DetailPage {
  key: string;
  route: DetailRoute;
  params: Record<string, string>;
  /** Shown by a selection in the book's left half: it fades in and out instead of sliding. */
  shown?: boolean;
  /** Shown in place of another page, which fades out over it, so it needs no fade of its own. */
  beneath?: boolean;
  /** Replaced by a selection: it fades out however it came. */
  fadeOut?: boolean;
}

let nextKey = 0;

interface DetailState {
  /** Per tab, the pages stacked over it on the iPhone Duo: its right half on the book, the whole tab folded. */
  pages: Record<string, DetailPage[]>;
  /** Pages already gone from the stack that still slide out on screen. */
  leaving: Record<string, DetailPage[]>;
  push: (tab: string, page: Omit<DetailPage, 'key'>) => void;
  /** What a selection in the primary column does: the page replaces whatever the right half showed. */
  show: (tab: string, page: Omit<DetailPage, 'key'>) => void;
  replace: (tab: string, page: Omit<DetailPage, 'key'>) => void;
  /** Back. `animated: false` when a swipe has already moved the page away. */
  pop: (tab: string, animated?: boolean) => void;
  /** A page that finished sliding out. */
  forget: (tab: string, key: string) => void;
  /** Back to the tab's own screen, as tapping its tab again does. */
  popToRoot: (tab: string) => void;
  clear: () => void;
}

const page = (p: Omit<DetailPage, 'key'>): DetailPage => ({ ...p, key: `d${nextKey++}` });

function samePage(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export const useDetailStore = create<DetailState>((set) => ({
  pages: {},
  leaving: {},
  push: (tab, p) => set((st) => ({ pages: { ...st.pages, [tab]: [...(st.pages[tab] ?? []), page(p)] } })),
  show: (tab, p) =>
    set((st) => {
      const stack = st.pages[tab] ?? [];
      const first = stack[0];
      const top = stack[stack.length - 1];
      const leaving = st.leaving[tab] ?? [];
      // Selecting what is already open beside the list goes back to it, scroll and all.
      if (first && first.route === p.route && samePage(first.params, p.params)) {
        if (stack.length === 1) return st;
        return { pages: { ...st.pages, [tab]: [first] }, leaving: { ...st.leaving, [tab]: [...leaving, top] } };
      }
      return {
        pages: { ...st.pages, [tab]: [{ ...page(p), shown: true, beneath: !!top }] },
        leaving: top ? { ...st.leaving, [tab]: [...leaving, { ...top, fadeOut: true }] } : st.leaving,
      };
    }),
  replace: (tab, p) => set((st) => ({ pages: { ...st.pages, [tab]: [...(st.pages[tab] ?? []).slice(0, -1), page(p)] } })),
  pop: (tab, animated = true) =>
    set((st) => {
      const stack = st.pages[tab] ?? [];
      const top = stack[stack.length - 1];
      if (!top) return st;
      return {
        pages: { ...st.pages, [tab]: stack.slice(0, -1) },
        leaving: animated ? { ...st.leaving, [tab]: [...(st.leaving[tab] ?? []), top] } : st.leaving,
      };
    }),
  forget: (tab, key) => set((st) => ({ leaving: { ...st.leaving, [tab]: (st.leaving[tab] ?? []).filter((p) => p.key !== key) } })),
  popToRoot: (tab) =>
    set((st) => {
      const stack = st.pages[tab] ?? [];
      const top = stack[stack.length - 1];
      // Only the page on screen leaves visibly; the ones under it go with it.
      return { pages: { ...st.pages, [tab]: [] }, leaving: { ...st.leaving, [tab]: top ? [top] : [] } };
    }),
  clear: () => set({ pages: {}, leaving: {} }),
}));

// A friend or invitation page belongs to the account that opened it.
useAccountStore.subscribe?.((state, previous) => {
  if (state.session?.accountId !== previous.session?.accountId) useDetailStore.getState().clear();
});

const EMPTY: DetailPage[] = [];

/** The route a page stands for, so screen telemetry counts it like the pushed screen. */
export function detailPathname(page: DetailPage): string {
  return WITH_ID.has(page.route) ? `/nv/${page.route}/${page.params.id ?? '-'}` : `/nv/${page.route}`;
}

export function useDetailPages(tab: string): DetailPage[] {
  return useDetailStore((st) => st.pages[tab] ?? EMPTY);
}

export function useLeavingPages(tab: string): DetailPage[] {
  return useDetailStore((st) => st.leaving[tab] ?? EMPTY);
}

