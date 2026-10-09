/**
 * One shared-menu write for a pub: shown here at once, then the full menu is
 * queued for the server so it survives a dead signal. The counter and the pub
 * page delete and fix beers through this; the contribute editor saves its own
 * draft the same way.
 */

import { generateUuidV4 } from '@/data/account';
import { buildCommunityEntry } from '@/data/communityClient';
import {
  historicalBeersAfterMenuReplacement,
  type CommunityBeer,
} from '@/data/communityHours';
import { enqueuePubCommunity } from '@/data/communityQueue';
import { useCommunityStore } from '@/stores/communityStore';

export interface MenuPub {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
}

/** Writes `next` for everyone and returns the history that goes with it. */
export function replacePubMenu(
  cell: string,
  pub: MenuPub,
  current: readonly CommunityBeer[],
  next: CommunityBeer[],
  historicalBeers: readonly CommunityBeer[],
): CommunityBeer[] {
  const nextHistory = historicalBeersAfterMenuReplacement(current, next, historicalBeers);
  useCommunityStore.getState().setOverride(cell, { beers: next, historicalBeers: nextHistory });
  void enqueuePubCommunity(
    buildCommunityEntry(
      {
        externalId: pub.id || null,
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        city: pub.city,
        beers: next,
      },
      generateUuidV4(),
    ),
  );
  return nextHistory;
}
