/**
 * How many evenings the user spent in one pub, from the same private sources
 * the pub search uses for "Tvoje stálice": local counter sessions plus the
 * synced visit history. Nothing leaves the phone; a privacy boundary (account
 * claim or deletion) clears the answer immediately.
 */

import { useEffect, useMemo, useState } from 'react';

import type { Pub } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import { loadVisitsSnapshot, subscribeVisitsBoundary, visitsSnapshotGeneration } from '@/data/visitsSnapshot';
import { buildVisitedPubs, type VisitedPubSummary } from '@/map/mapModel';
import { useAccountStore } from '@/stores/accountStore';
import { allSessionsNewestFirst, useTallyStore } from '@/stores/tallyStore';

export function usePubVisitSummary(pub: Pub | null, pubKey: string): VisitedPubSummary | null {
  const [cachedVisits, setCachedVisits] = useState<WireVisit[]>([]);
  const [privateDataAvailable, setPrivateDataAvailable] = useState(true);
  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const diary = useAccountStore((state) =>
    state.diarySnapshot?.accountId === state.session?.accountId ? state.diarySnapshot : null,
  );

  useEffect(() => {
    let active = true;
    const generation = visitsSnapshotGeneration();
    const unsubscribe = subscribeVisitsBoundary(() => {
      setPrivateDataAvailable(false);
      setCachedVisits([]);
    });
    void loadVisitsSnapshot().then((visits) => {
      if (active && generation === visitsSnapshotGeneration()) setCachedVisits(visits);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return useMemo(() => {
    if (!pub || !privateDataAvailable) return null;
    const visits = buildVisitedPubs(
      diary?.data.visits ?? cachedVisits,
      allSessionsNewestFirst(current, history),
      [pub],
    );
    return visits.find((visit) => visit.cacheKey === pubKey) ?? null;
  }, [pub, pubKey, privateDataAvailable, diary, cachedVisits, current, history]);
}
