import React, { createContext, useContext, useMemo } from 'react';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { useDetailStore, type DetailPage, type DetailRoute } from './detailStore';
import { useBook, useLastHalf, useRailSide } from './layout';
import { usePane } from './paneContext';

/**
 * Places to browse that open as a page of the tab on the iPhone Duo instead of
 * covering the window: a pub, a beer, a friend, an invitation, an evening, your
 * profile and its lists, the photo contest, tours, numbers, leaderboards and
 * meetups. The level under them stays usable beside them, like a split view's
 * second column. Tasks and forms stay panels.
 */
const DETAIL_PATHS: Record<string, DetailRoute> = {
  '/nv/hospoda/[id]': 'hospoda',
  '/nv/pivo/[id]': 'pivo',
  '/nv/kamos/[id]': 'kamos',
  '/nv/plan/[id]': 'plan',
  '/nv/vecer/[id]': 'vecer',
  '/nv/profil': 'profil',
  '/nv/nastaveni': 'nastaveni',
  '/nv/odznaky': 'odznaky',
  '/nv/pivni-fotky': 'pivni-fotky',
  '/nv/moje-hospody': 'moje-hospody',
  '/nv/hlidana-piva': 'hlidana-piva',
  '/nv/ohodnocena-piva': 'ohodnocena-piva',
  '/nv/fotopivar': 'fotopivar',
  '/nv/tour': 'tour',
  '/nv/cisla': 'cisla',
  '/nv/pivo-u-nekoho': 'pivo-u-nekoho',
  '/nv/moje-setkani': 'moje-setkani',
  '/nv/zebricky': 'zebricky',
};

export { detailPathname, useDetailPages, useDetailStore, useLeavingPages, type DetailPage, type DetailRoute } from './detailStore';

/** The detail a href opens, or null for any other screen. */
export function detailOf(href: Href): Omit<DetailPage, 'key'> | null {
  if (typeof href === 'string') {
    const route = DETAIL_PATHS[href];
    return route ? { route, params: {} } : null;
  }
  if (!href || !('pathname' in href)) return null;
  const route = DETAIL_PATHS[href.pathname];
  if (!route) return null;
  const params: Record<string, string> = {};
  for (const [name, value] of Object.entries((href as { params?: Record<string, unknown> }).params ?? {})) {
    if (value !== undefined && value !== null) params[name] = String(value);
  }
  return { route, params };
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

const TAB_ROOT = /^\/nv\/(kompas|vycep|stamgast|piva|parta)$/;

/**
 * The router for screens that open details. On the iPhone Duo a pub, beer,
 * friend, invitation, evening or your profile opened from a tab becomes a page
 * of that tab (the right half on the book, the whole tab folded), and back
 * inside such a page returns to what was under it. Everything else, and every
 * phone, gets the router.
 */
export function useNvRouter(): Router {
  const router = useRouter();
  const pane = usePane();
  const page = useContext(PageContext);
  const { book } = useBook();
  const rail = useRailSide();
  // On the iPhone Duo, folded or open, a detail opened inside a tab is a page of that tab;
  // a page already open keeps working the same way in any pose.
  const duo = book || rail !== null;
  const tab = (duo || page) && pane?.tab ? pane.tab : null;
  return useMemo(() => {
    if (!duo && !page) return router;
    const store = useDetailStore.getState;
    // Back to a tab, or to a place that is a page of one, also closes the pages above it, as on a phone.
    const dismissTo: Router['dismissTo'] = (href, options) => {
      const root = TAB_ROOT.exec(typeof href === 'string' ? href.split('?')[0] : href.pathname)?.[1];
      const detail = detailOf(href);
      if (root) store().popToRoot(root);
      else if (detail && Object.values(store().pages).some((pages) => pages.at(-1)?.route === detail.route)) return router.dismissAll();
      router.dismissTo(href, options);
    };
    if (!tab) return { ...router, dismissTo };
    const open = (href: Href, fallback: () => void) => {
      const detail = detailOf(href);
      // Like a split view: a selection in the left half replaces the right half on the book; anything
      // opened in the right half, or folded, goes on top of the stack.
      // Code that renders both halves (Parta) opens from the half that was touched.
      const side = pane?.side === 'single' ? useLastHalf.getState().half : pane?.side;
      if (detail && book && !page && side === 'left') store().show(tab, detail);
      else if (detail) store().push(tab, detail);
      else fallback();
    };
    return {
      ...router,
      push: (href, options) => open(href, () => router.push(href, options)),
      navigate: (href, options) => open(href, () => router.navigate(href, options)),
      replace: (href, options) => {
        const detail = detailOf(href);
        if (detail && page) store().replace(tab, detail);
        else if (detail) open(href, () => undefined);
        else if (page) {
          // Replacing a page with a task: the page goes and the task opens over the tabs, which stay.
          store().pop(tab, false);
          router.push(href, options);
        } else router.replace(href, options);
      },
      back: () => (page ? store().pop(tab) : router.back()),
      canGoBack: () => (page ? true : router.canGoBack()),
      dismissTo,
    };
  }, [book, duo, page, pane?.side, router, tab]);
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
