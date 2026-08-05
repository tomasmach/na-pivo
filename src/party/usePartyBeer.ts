/**
 * "+1 pivo", ať už na něj ťukneš kdekoliv.
 *
 * The hub, the glass bar and the game screen all have the same button, and it
 * has to mean the same thing in all three: one row in the diary, tagged with the
 * shared evening. So they call this, and this calls `logPartyBeer` — which is
 * the counter's own path (`src/party/logBeer.ts`).
 *
 * The only thing this hook adds is WHERE, and the order matters:
 *
 *   1. the running session's pub — if you are already counting somewhere, that
 *      is where you are, and a second opinion would split the evening in two;
 *   2. the pub picked for the night, by its geohash key;
 *   3. nothing known → filed as an evening outside a pub.
 *
 * Never a guessed pub. A drink at an unknown place is an honest "somewhere
 * else"; inventing a pub for it would put a stranger's local in your diary and
 * a price into a menu nobody paid.
 */

import React from 'react';

import { contextPubKey } from '@/drinks/drinkTypes';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { logPartyBeer, renamePartyBeer, unlogPartyBeer, type PartyBeerPlace } from '@/party/logBeer';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { useTallyStore } from '@/stores/tallyStore';

export interface PartyBeerActions {
  /** Count one. Returns its id, which is the id everywhere else too. */
  add: (beerName: string) => string;
  /** Take one back — a mis-tap, or a beer that never came. */
  remove: (drinkId: string) => void;
  /** Fix a typo in what it was called. */
  rename: (drinkId: string, beerName: string) => void;
}

export function usePartyBeer(): PartyBeerActions {
  const session = useTallyStore((s) => s.current);
  const pubName = useLivePartyStore((s) => s.pubName);
  const pubKey = useLivePartyStore((s) => s.pubKey);
  const partyCode = usePartyEveningStore((s) => s.evening?.joinCode ?? null);

  const place: PartyBeerPlace = React.useMemo(() => {
    if (session) {
      return {
        pubKey: session.pubKey,
        pubName: session.pubName,
        pubCity: session.pubCity,
        pubExternalId: session.pubExternalId,
      };
    }
    if (pubKey) return { pubKey, pubName };
    return { pubKey: contextPubKey('other'), pubName };
  }, [session, pubKey, pubName]);

  return React.useMemo(
    () => ({
      add: (beerName: string) => logPartyBeer({ place, beerName, partyCode }),
      remove: (drinkId: string) => unlogPartyBeer(drinkId),
      rename: (drinkId: string, beerName: string) => {
        // Renaming needs the session the drink lives in; without one there is
        // nothing logged to rename.
        if (session) renamePartyBeer(session, drinkId, beerName);
      },
    }),
    [place, partyCode, session],
  );
}
