import React, { createContext, useContext, useMemo } from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { create } from 'zustand';

import { useAccountStore } from '@/stores/accountStore';

import { useBook } from './layout';
import { usePane } from './pane';

/**
 * Pages that open into the right half of a tab on the open book instead of
 * covering the window: a pub, a beer, a friend, an invitation, an evening and your profile.
 */
const DETAIL_PATHS = {
  '/nv/hospoda/[id]': 'hospoda',
  '/nv/pivo/[id]': 'pivo',
  '/nv/kamos/[id]': 'kamos',
  '/nv/plan/[id]': 'plan',
  '/nv/vecer/[id]': 'vecer',
  '/nv/profil': 'profil',
} as const;

export type DetailRoute = (typeof DETAIL_PATHS)[keyof typeof DETAIL_PATHS];

export interface DetailPage {
  key: string;
  route: DetailRoute;
  params: Record<string, string>;
}

let nextKey = 0;

/** The detail a href opens, or null for any other screen. */
export function detailOf(href: Href): Omit<DetailPage, 'key'> | null {
  if (href === '/nv/profil') return { route: 'profil', params: {} };
  if (typeof href !== 'object' || !href || !('pathname' in href)) return null;
  const route = DETAIL_PATHS[href.pathname as keyof typeof DETAIL_PATHS];
  if (!route) return null;
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries((href as { params?: Record<string, unknown> }).params ?? {})) {
    if (value !== undefined && value !== null) params[name] = String(value);
  }
  return { route, params };
}

interface DetailState {
  /** Per tab, the pages stacked in its right half. They wait while the Duo is folded. */
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
useAccountStore.subscribe((state, previous) => {
  if (state.session?.accountId !== previous.session?.accountId) useDetailStore.getState().clear();
});

const EMPTY: DetailPage[] = [];

export function useDetailPages(tab: string): DetailPage[] {
  return useDetailStore((st) => st.pages[tab] ?? EMPTY);
}

const PageContext = createContext<DetailPage | null>(null);
export const DetailPageProvider = PageContext.Provider;

/** Route params, or the params of the detail page this screen shows in a half. */
export function useNvParams<T extends Record<string, string | undefined>>(): Partial<T> {
  const page = useContext(PageContext);
  const params = useLocalSearchParams<T>();
  return (page ? page.params : params) as Partial<T>;
}

/** True inside a page shown in the right half of a tab. */
export function useInDetailPage(): boolean {
  return useContext(PageContext) !== null;
}

type Router = ReturnType<typeof useRouter>;

/**
 * The router for screens that open details. On the open book a pub, beer,
 * friend or invitation opened from a tab goes into that tab's right half, and
 * back inside such a page returns in the half. Everything else is the router.
 */
export function useNvRouter(): Router {
  const router = useRouter();
  const pane = usePane();
  const page = useContext(PageContext);
  const { book } = useBook();
  // Every tab is split on the book, so anything inside a tab opens details into its right half.
  const tab = book && pane?.tab ? pane.tab : null;
  return useMemo(() => {
    if (!tab) return router;
    const store = useDetailStore.getState;
    const open = (href: Href, fallback: () => void) => {
      const detail = detailOf(href);
      if (detail) store().push(tab, detail);
      else fallback();
    };
    return {
      ...router,
      push: (href, options) => open(href, () => router.push(href, options)),
      navigate: (href, options) => open(href, () => router.navigate(href, options)),
      replace: (href, options) => {
        const detail = detailOf(href);
        if (detail && page) store().replace(tab, detail);
        else if (detail) store().push(tab, detail);
        else router.replace(href, options);
      },
      back: () => (page ? store().pop(tab) : router.back()),
      canGoBack: () => (page ? true : router.canGoBack()),
    };
  }, [page, router, tab]);
}

const screens: Partial<Record<DetailRoute, React.ComponentType>> = {};

/** The tabs layout registers the screens, so this module imports none of them. */
export function registerDetailScreens(map: Record<DetailRoute, React.ComponentType>): void {
  Object.assign(screens, map);
}

export function DetailPageView({ page }: { page: DetailPage }) {
  const Screen = screens[page.route];
  if (!Screen) return null;
  return (
    <DetailPageProvider value={page}>
      <Screen key={page.key} />
    </DetailPageProvider>
  );
}
