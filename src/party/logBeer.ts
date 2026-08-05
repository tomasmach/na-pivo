/**
 * Pivo z hubu — zapsané tam, kde se zapisuje všechno ostatní.
 *
 * The hub's "+1 pivo" must be the SAME +1 as the counter's. Not a similar one:
 * the same two stores, the same offline queue, the same row in the diary. The
 * previous shared-evening feature died of having its own place to log a beer
 * (`docs/decisions/one-write-two-readers.md`), and a hub that kept its own list
 * would be that mistake with a nicer thread on top.
 *
 * So this file owns no state at all. It writes to `tallyStore` (the local truth
 * the counter already keeps) and `drinksQueue` (the delivery the counter already
 * uses), and tags the drink with the shared evening's code so the table can see
 * it. Every number in the hub is then read back out of those same rows through
 * `buildNightRecord`.
 *
 * What it deliberately does NOT do, which is why it is not a second counter:
 * no undo window, no nudges, no community price merge, no XP. Those belong to
 * the counter screen, which is where somebody is deliberately counting; the hub
 * is where somebody is at a table and taps once.
 */

import { generateUuidV4 } from '@/data/account';
import { buildDrinkEntry } from '@/data/drinksClient';
import {
  enqueueDrink,
  flushDrinksQueue,
  removeQueuedDrink,
  updateQueuedDrinkBeerName,
} from '@/data/drinksQueue';
import { enqueueDelete } from '@/data/deleteDrinksQueue';
import { enqueueDrinkUpdate, removeQueuedDrinkUpdate } from '@/data/updateDrinksQueue';
import { decodeGeohash8 } from '@/data/geohash';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import type { DrinkType } from '@/drinks/drinkTypes';

export interface PartyBeerPlace {
  /** Geohash-8 of the pub — the durable identity of a place. */
  pubKey: string;
  pubName: string;
  pubCity?: string;
  pubExternalId?: string;
}

/**
 * Count one, from the hub.
 *
 * Returns the drink's client id, which is also its id everywhere else: in the
 * session, in the queue, on the server. One id, so taking it back later is a
 * lookup rather than a guess.
 */
export function logPartyBeer({
  place,
  beerName,
  drinkType = 'beer',
  priceCzk,
  volumeMl,
  partyCode,
  at,
}: {
  place: PartyBeerPlace;
  beerName: string;
  drinkType?: DrinkType;
  priceCzk?: number;
  volumeMl?: number;
  /** The shared evening, when there is one. */
  partyCode?: string | null;
  /** ISO-8601; defaults to now. */
  at?: string;
}): string {
  const id = generateUuidV4();
  const drankAt = at ?? new Date().toISOString();

  useTallyStore.getState().addDrink(
    { pubKey: place.pubKey, pubName: place.pubName, pubCity: place.pubCity },
    { id, beerName, drinkType, priceCzk, volumeMl, at: drankAt },
  );

  const entry = buildDrinkEntry(
    {
      externalId: place.pubExternalId ?? null,
      name: place.pubName,
      city: place.pubCity,
      ...decodeGeohash8(place.pubKey),
      drinkType,
      beer: { name: beerName, priceCzk, volumeMl },
      drankAt,
      ...(partyCode ? { partyCode } : {}),
    },
    id,
  );
  void enqueueDrink(entry).then((delivered) => {
    if (delivered) useTallyStore.getState().markDrinkSynced(id);
  });

  return id;
}

/**
 * Take one back — a mis-tap, or a beer that never arrived.
 *
 * The queue is tried first: a drink that never left the phone can simply be
 * dropped. One that did needs a DELETE, and that DELETE must wait for the
 * current flush, or it can overtake an in-flight POST and delete a row that has
 * not been created yet.
 */
export function unlogPartyBeer(drinkId: string): void {
  const removed = useTallyStore.getState().removeDrink(drinkId);
  if (!removed) return;

  void removeQueuedDrinkUpdate(drinkId);
  void removeQueuedDrink(drinkId).then((pulledFromQueue) => {
    if (pulledFromQueue) return;
    void flushDrinksQueue()
      .then(() => enqueueDelete(drinkId))
      .catch(() => undefined);
  });
}

/**
 * Fix what it was called.
 *
 * The log is the only place you can see WHICH beer was logged wrong, so it is
 * where correcting it belongs. Renaming never touches the price, the pub or the
 * time — those were right, the name was a typo.
 */
export function renamePartyBeer(session: TallySession, drinkId: string, beerName: string): void {
  const trimmed = beerName.trim();
  if (!trimmed) return;
  const changed = useTallyStore
    .getState()
    .updateDrinkNameInSession(session.startedAt, drinkId, trimmed);
  if (!changed) return;

  void updateQueuedDrinkBeerName(drinkId, trimmed).then((state) => {
    // Not in the queue any more means it is already on the server, so the fix
    // has to travel as its own update.
    if (state !== 'queued') void enqueueDrinkUpdate({ client_id: drinkId, beer_name: trimmed });
  });
}
