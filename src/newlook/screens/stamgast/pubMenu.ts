import { useEffect, useState } from 'react';

import { generateUuidV4 } from '@/data/account';
import { buildCommunityEntry } from '@/data/communityClient';
import { historicalBeersAfterMenuReplacement, mergeBeerIntoMenu, type CommunityBeer } from '@/data/communityHours';
import { enqueuePubCommunity } from '@/data/communityQueue';
import { geohash8 } from '@/data/geohash';
import { fetchPubHours } from '@/data/hoursClient';
import type { Pub } from '@/data/pubs';
import { isBeerListOverrideCurrent, useCommunityStore } from '@/stores/communityStore';

export interface PubMenu {
  beers: CommunityBeer[];
  historicalBeers: CommunityBeer[];
  /** The server answered in this session, so a full-menu write cannot drop beers. */
  fresh: boolean;
  loading: boolean;
}

/** The pub's current beer menu: the user's newer local edit, else the server's, else the cached one. */
export function usePubMenu(pub: Pub | null): PubMenu {
  const cell = pub ? geohash8(pub.lat, pub.lng) : null;
  const override = useCommunityStore((s) => (cell ? s.overrides[cell] : undefined));
  const [answer, setAnswer] = useState<{ pubId: string; beers: CommunityBeer[]; historicalBeers: CommunityBeer[]; updatedAt: string | null } | null>(null);
  const [doneFor, setDoneFor] = useState<string | null>(null);

  useEffect(() => {
    if (!pub) return undefined;
    const controller = new AbortController();
    void fetchPubHours([pub], controller.signal).then((results) => {
      if (controller.signal.aborted) return;
      const result = results.get(pub.id);
      setDoneFor(pub.id);
      if (result) {
        setAnswer({ pubId: pub.id, beers: result.beers, historicalBeers: result.historicalBeers, updatedAt: result.beersUpdatedAt });
      }
    });
    return () => controller.abort();
  }, [pub]);

  const server = pub && answer?.pubId === pub.id ? answer : null;
  const overrideCurrent = isBeerListOverrideCurrent(override, server?.updatedAt ?? pub?.beersUpdatedAt);
  const beers = overrideCurrent && override?.beers ? override.beers : server?.beers.length ? server.beers : (pub?.beers ?? []);
  const historicalBeers = overrideCurrent && override?.historicalBeers ? override.historicalBeers : (server?.historicalBeers ?? pub?.historicalBeers ?? []);
  return { beers, historicalBeers, fresh: !!server, loading: !!pub && doneFor !== pub.id };
}

/** Add beers to a pub's menu for everyone: shown here at once, queued for the server. */
export function addBeersToMenu(pub: Pub, menu: PubMenu, added: readonly CommunityBeer[]): void {
  const cell = geohash8(pub.lat, pub.lng);
  const next = added.reduce<CommunityBeer[]>((list, beer) => mergeBeerIntoMenu(list, beer), [...menu.beers]);
  const nextHistory = historicalBeersAfterMenuReplacement(menu.beers, next, menu.historicalBeers);
  useCommunityStore.getState().setOverride(cell, { beers: next, historicalBeers: nextHistory });
  void enqueuePubCommunity(
    buildCommunityEntry({ externalId: pub.id && !pub.id.startsWith('tally:') ? pub.id : null, name: pub.name, lat: pub.lat, lng: pub.lng, city: pub.city, beers: next, beersBase: menu.beers }, generateUuidV4()),
  );
}
