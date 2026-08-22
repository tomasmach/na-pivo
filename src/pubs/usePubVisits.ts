import { useEffect, useState } from 'react';

import { fetchVisits, type WireVisit } from '@/data/visitsClient';
import {
  loadVisitsSnapshot,
  saveVisitsSnapshot,
  subscribeVisitsBoundary,
  visitsSnapshotGeneration,
} from '@/data/visitsSnapshot';

export function usePubVisits(): WireVisit[] {
  const [visits, setVisits] = useState<WireVisit[]>([]);

  useEffect(() => {
    let active = true;
    let remoteCommitted = false;
    const controller = new AbortController();
    const generation = visitsSnapshotGeneration();

    const unsubscribe = subscribeVisitsBoundary(() => {
      if (active) setVisits([]);
    });

    void loadVisitsSnapshot().then((cached) => {
      if (active && !remoteCommitted && generation === visitsSnapshotGeneration()) {
        setVisits(cached);
      }
    });
    void fetchVisits(controller.signal).then((remote) => {
      if (!active || remote == null || generation !== visitsSnapshotGeneration()) return;
      remoteCommitted = true;
      setVisits(remote);
      void saveVisitsSnapshot(remote, generation);
    });

    return () => {
      active = false;
      controller.abort();
      unsubscribe();
    };
  }, []);

  return visits;
}
