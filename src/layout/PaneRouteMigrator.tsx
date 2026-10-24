import { useEffect } from 'react';
import { useRootNavigationState, useRouter } from 'expo-router';

import { useBookLayout } from '@/layout/bookLayout';
import { appRoutes, paneEntriesFromRoutes, type RouteLike } from '@/layout/paneRoutes';
import { useBookStore } from '@/stores/bookStore';

/**
 * Pages pushed as routes belong in the right half once the window is wide:
 * unfolding over a pub page, a link or a notification that opened one, or an
 * opener that still pushes. They move into the active tab's half and the
 * stack returns to the tabs.
 */
export function PaneRouteMigrator() {
  const router = useRouter();
  const { wide } = useBookLayout();
  const state = useRootNavigationState();

  useEffect(() => {
    if (!wide || !state?.routes) return;
    const moved = paneEntriesFromRoutes(appRoutes(state.routes as unknown as RouteLike[]));
    if (!moved) return;
    useBookStore.getState().setPages(moved.tab, moved.entries);
    if (moved.underTabs) router.dismissAll();
    else router.replace('/');
  }, [router, state, wide]);

  return null;
}
