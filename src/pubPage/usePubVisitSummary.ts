/**
 * How many evenings the user spent in one pub, from the same private sources
 * the pub search uses for "Tvoje stálice": local counter sessions plus the
 * synced visit history. Nothing leaves the phone; a privacy boundary (account
 * claim or deletion) clears the answer immediately.
 */

import { useEffect, useMemo, useState } from 'react';

import type { Pub } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import {
  loadVisitsSnapshot,
  subscribeVisitsBoundary,
  visitsSnapshotGeneration,
} from '@/data/visitsSnapshot';
import { buildVisitedPubs, type VisitedPubSummary } from '@/map/mapModel';
import { useAccountStore } from '@/stores/accountStore';
import { allSessionsNewestFirst, useTallyStore } from '@/stores/tallyStore';

import { isSamePubRecord } from './pubPageModel';

export function usePubVisitSummary(pub: Pub | null, pubKey: string): VisitedPubSummary | null {
  const [cachedVisits, setCachedVisits] = useState<WireVisit[]>([]);
  const [privateDataAvailable, setPrivateDataAvailable] = useState(true);
  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const diary = useAccountStore((state) =>
    state.diarySnapshot?.accountId === state.session?.accountId ? state.diarySnapshot : null,
  );
  const accountId = useAccountStore((state) => state.session?.accountId);

  // Runs again for another account: the boundary hid the previous history, this one loads its own.
  useEffect(() => {
    let active = true;
    const generation = visitsSnapshotGeneration();
    const unsubscribe = subscribeVisitsBoundary(() => {
      setPrivateDataAvailable(false);
      setCachedVisits([]);
    });
    void loadVisitsSnapshot().then((visits) => {
      if (!active || generation !== visitsSnapshotGeneration()) return;
      setCachedVisits(visits);
      setPrivateDataAvailable(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accountId]);

  return useMemo(() => {
    if (!pub || !privateDataAvailable) return null;
    // One cell can hold two pubs: count only records of this one.
    const visits = buildVisitedPubs(
      (diary?.data.visits ?? cachedVisits).filter((visit) =>
        isSamePubRecord({ name: visit.name, externalId: visit.external_id }, pub),
      ),
      allSessionsNewestFirst(current, history).filter((session) =>
        isSamePubRecord({ name: session.pubName, externalId: session.pubExternalId }, pub),
      ),
      [pub],
    );
    return visits.find((visit) => visit.cacheKey === pubKey) ?? null;
  }, [pub, pubKey, privateDataAvailable, diary, cachedVisits, current, history]);
}
