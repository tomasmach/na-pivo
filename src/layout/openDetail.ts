/**
 * The one place that opens a pub, an evening or a friend's profile. On a phone
 * it pushes the route exactly as the screens always did. On a wide window it
 * opens the page in the right half of the tab underneath instead, unless a
 * full-window screen (leaderboards, a tour, settings) is in front of the tabs.
 */

import type { Href, useRouter } from 'expo-router';

import { currentBookMode } from '@/layout/bookLayout';
import type { BookTab } from '@/layout/pane';
import { useBookStore, type PageEntry } from '@/stores/bookStore';

type Router = Pick<ReturnType<typeof useRouter>, 'push' | 'replace' | 'back'>;

const TAB_ROOTS: Readonly<Record<string, BookTab>> = {
  '/': 'kompas',
  '/beer': 'stamgast',
  '/friends': 'parta',
  '/profile': 'profil',
};

const SEARCH = '/pub-search';

let topPathname = '/';
let underSearch = '/';

/** Fed by the root layout so helpers outside React know what is on screen. */
export function noteTopPathname(pathname: string): void {
  if (pathname === SEARCH && topPathname !== SEARCH) underSearch = topPathname;
  topPathname = pathname;
}

/** The tab whose root is on screen, or null under a pushed route. */
export function tabForPathname(pathname: string): BookTab | null {
  return TAB_ROOTS[pathname] ?? null;
}

export function hrefFor(entry: PageEntry): Href {
  switch (entry.kind) {
    case 'pub':
      return { pathname: '/pub', params: entry.params } as unknown as Href;
    case 'evening':
      return { pathname: '/evening', params: { startedAt: entry.startedAt } };
    case 'friend':
      return `/parta/${entry.id}` as Href;
  }
}

/** The route a right-half page stands for, so it counts as that screen. */
export function pagePathname(entry: PageEntry): string {
  if (entry.kind === 'friend') return `/parta/${entry.id}`;
  return entry.kind === 'pub' ? '/pub' : '/evening';
}

export function openDetail(router: Router, entry: PageEntry, options: { replace?: boolean } = {}): void {
  if (currentBookMode() !== 'phone') {
    const book = useBookStore.getState();
    const tab = TAB_ROOTS[topPathname];
    if (tab) {
      if (options.replace) book.replace(tab, entry);
      else book.show(tab, entry);
      return;
    }
    // Search over a tab is a doorway: close it and show the result beside that tab.
    const searchedTab = topPathname === SEARCH ? TAB_ROOTS[underSearch] : undefined;
    if (searchedTab) {
      router.back();
      book.show(searchedTab, entry);
      return;
    }
  }
  const href = hrefFor(entry);
  if (options.replace) router.replace(href);
  else router.push(href);
}

export function openEvening(router: Router, startedAt: string): void {
  openDetail(router, { kind: 'evening', startedAt });
}

export function openFriendProfile(router: Router, id: string): void {
  openDetail(router, { kind: 'friend', id });
}
