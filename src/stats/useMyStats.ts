/**
 * Fetches the account's durable beer stats once when the "Výkon" screen mounts
 * (which, as a tab segment, happens each time the user switches to it). Returns
 * null until/unless they arrive — the screen always renders from local data and
 * only overlays these durable numbers when present. Never throws; offline / no
 * account simply leaves the local view in place.
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchMyStats, type RemoteStats } from '@/data/statsClient';
import { useAccountStore } from '@/stores/accountStore';

export interface MyStatsState {
  stats: RemoteStats | null;
  status: 'loading' | 'ready' | 'unavailable';
  retry: () => void;
}

export function useMyStatsState(): MyStatsState {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const [snapshot, setSnapshot] = useState<{
    requestKey: string;
    accountId: string | null;
    stats: RemoteStats | null;
    status: Exclude<MyStatsState['status'], 'loading'>;
  } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);
  const requestKey = `${accountId ?? 'anonymous'}:${retryNonce}`;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetchMyStats(controller.signal).then((result) => {
      if (!active) return;
      if (result) {
        setSnapshot({ requestKey, accountId, stats: result, status: 'ready' });
      } else {
        setSnapshot({ requestKey, accountId, stats: null, status: 'unavailable' });
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, requestKey]);

  const current = snapshot?.requestKey === requestKey ? snapshot : null;

  return {
    stats: current?.accountId === accountId ? current.stats : null,
    status: current?.status ?? 'loading',
    retry,
  };
}

export function useMyStats(): RemoteStats | null {
  return useMyStatsState().stats;
}
