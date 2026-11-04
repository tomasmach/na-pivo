/**
 * Fetches the account's durable beer stats once when the "Výkon" screen mounts
 * (which, as a tab segment, happens each time the user switches to it), and
 * again after a drink is removed. Returns null until/unless they arrive — the
 * screen always renders from local data and only overlays these durable numbers
 * when present. Never throws; offline / no account simply leaves the local view
 * in place. `enabled` holds the fetch back until the caller is first on screen.
 */

import { useEffect, useState } from 'react';

import { getConfirmedDeleteIds, getQueuedDeleteIds } from '@/data/deleteDrinksQueue';
import { fetchMyStats, type RemoteStats } from '@/data/statsClient';
import { useAccountStore } from '@/stores/accountStore';

export function useMyStats(enabled = true): RemoteStats | null {
  return useMyStatsState(enabled).stats;
}

/** Same as `useMyStats`, plus whether the latest fetch has finished, so an empty screen can tell "nothing yet" from "still loading". */
export function useMyStatsState(enabled = true, allPubs = false): { stats: RemoteStats | null; settled: boolean } {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const removedDrinkIds = useAccountStore((state) => state.removedDrinkIds);
  const [snapshot, setSnapshot] = useState<{
    accountId: string | null;
    removedDrinkIds: ReadonlySet<string>;
    stats: RemoteStats;
  } | null>(null);
  const [settledFor, setSettledFor] = useState<{ accountId: string | null; removedDrinkIds: ReadonlySet<string> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    void (async () => {
      // The server still counts a removed drink until its DELETE lands.
      const confirmed = getConfirmedDeleteIds();
      const pending = new Set(await getQueuedDeleteIds());
      removedDrinkIds.forEach((id) => {
        if (!confirmed.has(id)) pending.add(id);
      });
      const result = await fetchMyStats(controller.signal, [...pending], allPubs);
      if (!active) return;
      if (result) setSnapshot({ accountId, removedDrinkIds, stats: result });
      setSettledFor({ accountId, removedDrinkIds });
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, allPubs, enabled, removedDrinkIds]);

  // Stats read before the latest removal still count that drink.
  const stats = snapshot?.accountId === accountId && snapshot.removedDrinkIds === removedDrinkIds ? snapshot.stats : null;
  const settled = settledFor?.accountId === accountId && settledFor.removedDrinkIds === removedDrinkIds;
  return { stats, settled };
}
