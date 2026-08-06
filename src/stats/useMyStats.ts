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
    accountId: string | null;
    stats: RemoteStats;
  } | null>(null);
  const [status, setStatus] = useState<MyStatsState['status']>('loading');
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setStatus('loading');
    void fetchMyStats(controller.signal).then((result) => {
      if (!active) return;
      if (result) {
        setSnapshot({ accountId, stats: result });
        setStatus('ready');
      } else {
        setStatus('unavailable');
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, retryNonce]);

  return {
    stats: snapshot?.accountId === accountId ? snapshot.stats : null,
    status,
    retry,
  };
}

export function useMyStats(): RemoteStats | null {
  return useMyStatsState().stats;
}
