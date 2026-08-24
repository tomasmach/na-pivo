import { useEffect, useRef, useState } from 'react';

import { fetchVisits, type WireVisit } from '@/data/visitsClient';
import {
  loadVisitsSnapshot,
  saveVisitsSnapshot,
  subscribeVisitsBoundary,
  visitsSnapshotGeneration,
} from '@/data/visitsSnapshot';
import { useAccountStore } from '@/stores/accountStore';

interface OwnedVisits {
  accountId: string;
  revision: number;
  visits: WireVisit[];
}

const NO_VISITS: OwnedVisits = { accountId: '', revision: -1, visits: [] };

export function usePubVisits(): WireVisit[] {
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const [revision, setRevision] = useState(0);
  const [owned, setOwned] = useState<OwnedVisits>(NO_VISITS);
  const hydratedAccountRef = useRef<string | null>(null);
  const hydrationLockedRef = useRef(false);

  useEffect(
    () =>
      subscribeVisitsBoundary(() => {
        setRevision((previous) => previous + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    let remoteCommitted = false;
    const controller = new AbortController();
    const generation = visitsSnapshotGeneration();

    // Only the first identity of this mount may hydrate the global raw
    // snapshot; once a different account appears in-process, storage reads
    // stop for good so another account's cache can never surface.
    if (
      !hydrationLockedRef.current &&
      (hydratedAccountRef.current === null || hydratedAccountRef.current === accountId)
    ) {
      hydratedAccountRef.current = accountId;
      void loadVisitsSnapshot().then((cached) => {
        if (!active || remoteCommitted || generation !== visitsSnapshotGeneration()) return;
        setOwned({ accountId, revision, visits: cached });
      });
    } else {
      hydrationLockedRef.current = true;
    }
    void fetchVisits(controller.signal).then((remote) => {
      if (!active || remote == null || generation !== visitsSnapshotGeneration()) return;
      remoteCommitted = true;
      setOwned({ accountId, revision, visits: remote });
      void saveVisitsSnapshot(remote, generation);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, revision]);

  return owned.accountId === accountId && owned.revision === revision ? owned.visits : [];
}
