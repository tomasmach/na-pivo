import type { BookTab } from '@/layout/pane';
import type { PageEntry } from '@/stores/bookStore';

/** The slice of a navigation route this needs; nested state only for `(tabs)`. */
export interface RouteLike {
  name: string;
  params?: object;
  state?: { index?: number; routes?: RouteLike[] };
}

/** The app's own stack: Expo Router wraps the root layout in a single `__root` route. */
export function appRoutes(routes: readonly RouteLike[]): readonly RouteLike[] {
  const [only] = routes;
  return routes.length === 1 && only.name === '__root' && only.state?.routes ? appRoutes(only.state.routes) : routes;
}

const TAB_BY_ROUTE: Readonly<Record<string, BookTab>> = {
  index: 'kompas',
  beer: 'stamgast',
  friends: 'parta',
  profile: 'profil',
};

function param(params: object | undefined, name: string): string | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

function entryFor(route: RouteLike): PageEntry | null {
  const { name, params } = route;
  if (name === 'pub') {
    const key = param(params, 'key');
    const lat = param(params, 'lat');
    const lng = param(params, 'lng');
    if (!key || !lat || !lng) return null;
    const ref = param(params, 'ref');
    return {
      kind: 'pub',
      params: { key, ...(ref ? { ref } : {}), name: param(params, 'name') ?? '', lat, lng },
    };
  }
  if (name === 'evening') {
    const startedAt = param(params, 'startedAt');
    return startedAt ? { kind: 'evening', startedAt } : null;
  }
  if (name === 'parta/[id]') {
    const id = param(params, 'id');
    return id ? { kind: 'friend', id } : null;
  }
  return null;
}

/**
 * When everything stacked above the tabs is a pub, an evening or a friend, the
 * pages that belong in the right half of a wide window, plus the tab they open
 * over. Null when anything else is in front (a leaderboard, a tour, settings),
 * which stays a full-window screen.
 */
export function paneEntriesFromRoutes(
  routes: readonly RouteLike[],
): { tab: BookTab; entries: PageEntry[]; underTabs: boolean } | null {
  const underTabs = routes[0]?.name === '(tabs)';
  const above = underTabs ? routes.slice(1) : routes;
  if (above.length === 0) return null;
  const entries: PageEntry[] = [];
  for (const route of above) {
    const entry = entryFor(route);
    if (!entry) return null;
    entries.push(entry);
  }
  const tabsState = underTabs ? routes[0].state : undefined;
  const activeRoute = tabsState?.routes?.[tabsState.index ?? 0]?.name;
  const tab = (activeRoute && TAB_BY_ROUTE[activeRoute]) || 'kompas';
  return { tab, entries, underTabs };
}
