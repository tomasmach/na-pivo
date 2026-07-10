/**
 * Fetches the account's durable beer stats once when the "Výkon" screen mounts
 * (which, as a tab segment, happens each time the user switches to it). Returns
 * null until/unless they arrive — the screen always renders from local data and
 * only overlays these durable numbers when present. Never throws; offline / no
 * account simply leaves the local view in place.
 */

import { useEffect, useState } from 'react';

import { fetchMyStats, type RemoteStats } from '@/data/statsClient';

export function useMyStats(): RemoteStats | null {
  const [stats, setStats] = useState<RemoteStats | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetchMyStats(controller.signal).then((result) => {
      if (active && result) setStats(result);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return stats;
}
