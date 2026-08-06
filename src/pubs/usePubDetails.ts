import { useEffect, useState } from 'react';

import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import type { Pub } from '@/data/pubs';

export function mergePubHours(pub: Pub, details: PubHoursResult): Pub {
  return {
    ...pub,
    openingHours: details.openingHours,
    isOpenNow: details.isOpenNow,
    nextChange: details.nextChange,
    hoursStatus: details.status,
    hoursSource: details.source ?? undefined,
    communityHours: details.communityHours ?? undefined,
    beers: details.beers,
    historicalBeers: details.historicalBeers,
    beersUpdatedAt: details.beersUpdatedAt,
    beerMenuRotates: details.beerMenuRotates,
    hoursUpdatedAt: details.hoursUpdatedAt,
    rating: details.rating ?? pub.rating,
    ratingCount: details.ratingCount ?? pub.ratingCount,
    ratingLabel: details.ratingLabel ?? pub.ratingLabel,
    hasGarden: details.hasGarden ?? pub.hasGarden,
    venueKind: details.venueKind,
  };
}

export function usePubDetails(pub: Pub): Pub {
  const [resolved, setResolved] = useState<{ id: string; pub: Pub } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryIndex = 0;
    const retryDelays = [10_000, 30_000] as const;

    const load = () => void fetchPubHours([pub], controller.signal).then((results) => {
      const details = results.get(pub.id);
      if (!details || controller.signal.aborted) return;
      setResolved({ id: pub.id, pub: mergePubHours(pub, details) });
      if (details.status === 'pending' && retryIndex < retryDelays.length) {
        const delay = retryDelays[retryIndex];
        retryIndex += 1;
        timer = setTimeout(load, delay);
      }
    });
    load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [pub]);

  return resolved?.id === pub.id ? resolved.pub : pub;
}
