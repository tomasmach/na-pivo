import { create } from 'zustand';

import { useAccountStore } from '@/stores/accountStore';

export type DetailRoute = 'hospoda' | 'pivo' | 'kamos' | 'plan' | 'vecer' | 'profil';

export interface DetailPage {
  key: string;
  route: DetailRoute;
  params: Record<string, string>;
}

let nextKey = 0;

interface DetailState {
  /** Per tab, the pages stacked over it on the iPhone Duo: its right half on the book, the whole tab folded. */
  pages: Record<string, DetailPage[]>;
  push: (tab: string, page: Omit<DetailPage, 'key'>) => void;
  replace: (tab: string, page: Omit<DetailPage, 'key'>) => void;
  pop: (tab: string) => void;
  clear: () => void;
}

export const useDetailStore = create<DetailState>((set) => ({
  pages: {},
  push: (tab, page) => set((st) => ({ pages: { ...st.pages, [tab]: [...(st.pages[tab] ?? []), { ...page, key: `d${nextKey++}` }] } })),
  replace: (tab, page) =>
    set((st) => ({ pages: { ...st.pages, [tab]: [...(st.pages[tab] ?? []).slice(0, -1), { ...page, key: `d${nextKey++}` }] } })),
  pop: (tab) => set((st) => ({ pages: { ...st.pages, [tab]: (st.pages[tab] ?? []).slice(0, -1) } })),
  clear: () => set({ pages: {} }),
}));

// A friend or invitation page belongs to the account that opened it.
useAccountStore.subscribe?.((state, previous) => {
  if (state.session?.accountId !== previous.session?.accountId) useDetailStore.getState().clear();
});

const EMPTY: DetailPage[] = [];

/** The route a page stands for, so screen telemetry counts it like the pushed screen. */
export function detailPathname(page: DetailPage): string {
  return page.route === 'profil' ? '/nv/profil' : `/nv/${page.route}/${page.params.id ?? '-'}`;
}

export function useDetailPages(tab: string): DetailPage[] {
  return useDetailStore((st) => st.pages[tab] ?? EMPTY);
}

