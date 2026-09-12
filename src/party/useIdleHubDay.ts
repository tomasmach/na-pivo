import { useMemo } from 'react';

import { useNowTick } from '@/friends/useNowTick';
import { idleBeerCount, lastArchivedSession } from '@/party/idleHubModel';
import type { TallySession } from '@/stores/tallyStore';

/** Keep the idle count and the last-night row on the same drinking day. */
export function useIdleHubDay(current: TallySession | null, history: readonly TallySession[]) {
  const now = useNowTick();
  return useMemo(() => {
    const date = new Date(now);
    return {
      beerCount: idleBeerCount(current, history, date),
      lastSession: lastArchivedSession(history, date),
    };
  }, [current, history, now]);
}
