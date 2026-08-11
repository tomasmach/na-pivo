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
import { useLivePartyStore, type PartyPubVisit } from '@/mocks/livePartyStore';
import { logPartyBeer, renamePartyBeer, unlogPartyBeer, updatePartyDrink, type PartyBeerPlace } from '@/party/logBeer';
import type { DrinkType, ServingType } from '@/drinks/drinkTypes';
import {
  selectPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';
import { useTallyStore } from '@/stores/tallyStore';

export interface PartyBeerActions {
  /** Count one. Returns its id, which is the id everywhere else too. */
  add: (
    beerName: string,
    options?: {
      partyCode?: string | null;
      deferDelivery?: boolean;
      visit?: PartyPubVisit;
      drinkType?: DrinkType;
      priceCzk?: number;
      volumeMl?: number;
      servingType?: ServingType;
    },
  ) => string;
  /** Take one back — a mis-tap, or a beer that never came. */
  remove: (drinkId: string) => void;
  /** Fix a typo in what it was called. */
  rename: (drinkId: string, beerName: string) => void;
  update: typeof updatePartyDrink;
}

export function usePartyBeer(): PartyBeerActions {
  const session = useTallyStore((s) => s.current);
  const pubName = useLivePartyStore((s) => s.pubName);
  const pubKey = useLivePartyStore((s) => s.pubKey);
  const selectedVisit = useLivePartyStore((s) => s.pubVisits.at(-1) ?? null);
  const partyCode = usePartyEveningStore(selectPartyJoinCode);
  const tableCreatePending = usePartyEveningStore(
    (s) => !s.evening && s.pendingJoinCode !== null,
  );

  const place: PartyBeerPlace = React.useMemo(() => {
    if (selectedVisit && selectedVisit.pubKey === pubKey) {
      return {
        pubKey: selectedVisit.pubKey,
        pubName: selectedVisit.pubName,
        pubCity: selectedVisit.pubCity,
        pubExternalId: selectedVisit.pubExternalId,
        visitClientId: selectedVisit.clientId,
        visitStartedAt: selectedVisit.startedAt,
      };
    }
    // A pub explicitly picked in the hub wins when it differs from the current
    // counter session: that difference means the table moved, and the next
    // drink must roll the tally into a new visit instead of staying at the old
    // pub forever.
    if (pubKey && pubKey !== session?.pubKey) return { pubKey, pubName };
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
  }, [session, pubKey, pubName, selectedVisit]);

  return React.useMemo(
    () => ({
      add: (
        beerName: string,
        options?: {
          partyCode?: string | null;
          deferDelivery?: boolean;
          visit?: PartyPubVisit;
          drinkType?: DrinkType;
          priceCzk?: number;
          volumeMl?: number;
          servingType?: ServingType;
        },
      ) => logPartyBeer({
        place: options?.visit
          ? {
              pubKey: options.visit.pubKey,
              pubName: options.visit.pubName,
              pubCity: options.visit.pubCity,
              pubExternalId: options.visit.pubExternalId,
              visitClientId: options.visit.clientId,
              visitStartedAt: options.visit.startedAt,
            }
          : place,
        beerName,
        drinkType: options?.drinkType,
        priceCzk: options?.priceCzk,
        volumeMl: options?.volumeMl,
        servingType: options?.servingType,
        partyCode: options?.partyCode === undefined ? partyCode : options.partyCode,
        deferDelivery: options?.deferDelivery ?? tableCreatePending,
      }),
      remove: (drinkId: string) => unlogPartyBeer(drinkId),
      rename: (drinkId: string, beerName: string) => renamePartyBeer(drinkId, beerName),
      update: updatePartyDrink,
    }),
    [place, partyCode, tableCreatePending],
  );
}
