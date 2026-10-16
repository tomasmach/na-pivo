/**
 * Fetches the account's durable beer stats once when the "Výkon" screen mounts
 * (which, as a tab segment, happens each time the user switches to it), and
 * again after a drink is removed. Returns null until/unless they arrive — the
 * screen always renders from local data and only overlays these durable numbers
 * when present. Never throws; offline / no account simply leaves the local view
 * in place.
 */

import { useEffect, useState } from 'react';

import { getConfirmedDeleteIds, getQueuedDeleteIds } from '@/data/deleteDrinksQueue';
import { fetchMyStats, type RemoteStats } from '@/data/statsClient';
import { useAccountStore } from '@/stores/accountStore';

export function useMyStats(): RemoteStats | null {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const removedDrinkIds = useAccountStore((state) => state.removedDrinkIds);
  const [snapshot, setSnapshot] = useState<{
    accountId: string | null;
    removedDrinkIds: ReadonlySet<string>;
    stats: RemoteStats;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void (async () => {
      // The server still counts a removed drink until its DELETE lands.
      const confirmed = getConfirmedDeleteIds();
      const pending = new Set(await getQueuedDeleteIds());
      removedDrinkIds.forEach((id) => {
        if (!confirmed.has(id)) pending.add(id);
      });
      const result = await fetchMyStats(controller.signal, [...pending]);
      if (active && result) setSnapshot({ accountId, removedDrinkIds, stats: result });
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, removedDrinkIds]);

  // Stats read before the latest removal still count that drink.
  return snapshot?.accountId === accountId && snapshot.removedDrinkIds === removedDrinkIds
    ? snapshot.stats
    : null;
}
