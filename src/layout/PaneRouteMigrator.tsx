import { useEffect } from 'react';
import { useRootNavigationState, useRouter } from 'expo-router';

import { useBookLayout } from '@/layout/bookLayout';
import { appRoutes, paneEntriesFromRoutes, type RouteLike } from '@/layout/paneRoutes';
import { selectAnySheetOpen, useBookStore } from '@/stores/bookStore';

/**
 * Pages pushed as routes belong in the right half once the window is wide:
 * unfolding over a pub page, a link or a notification that opened one, or an
 * opener that still pushes. They move into the active tab's half and the
 * stack returns to the tabs. Moving remounts them, so it waits until every
 * sheet is closed: a half-written drink or rename stays where it is.
 */
export function PaneRouteMigrator() {
  const router = useRouter();
  const { wide } = useBookLayout();
  const state = useRootNavigationState();
  const sheetOpen = useBookStore(selectAnySheetOpen);

  useEffect(() => {
    if (!wide || sheetOpen || !state?.routes) return;
    const moved = paneEntriesFromRoutes(appRoutes(state.routes as unknown as RouteLike[]));
    if (!moved) return;
    useBookStore.getState().setPages(moved.tab, moved.entries);
    if (moved.underTabs) router.dismissAll();
    else router.replace('/');
  }, [router, sheetOpen, state, wide]);

  return null;
}
