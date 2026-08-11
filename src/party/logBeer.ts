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
  updateQueuedDrink,
  updateQueuedDrinkBeerName,
} from '@/data/drinksQueue';
import { enqueueDelete } from '@/data/deleteDrinksQueue';
import { enqueueDrinkUpdate, removeQueuedDrinkUpdate } from '@/data/updateDrinksQueue';
import { decodeGeohash8 } from '@/data/geohash';
import { syncVisit } from '@/data/visitsSync';
import { flushVisitsQueue } from '@/data/visitsQueue';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import { contextFromPubKey, type DrinkType, type ServingType } from '@/drinks/drinkTypes';

export interface PartyBeerPlace {
  /** Geohash-8 of the pub — the durable identity of a place. */
  pubKey: string;
  pubName: string;
  pubCity?: string;
  pubExternalId?: string;
  /** Explicit stop selected before the first beer. */
  visitClientId?: string;
  visitStartedAt?: string;
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
  servingType,
  partyCode,
  deferDelivery = false,
  at,
}: {
  place: PartyBeerPlace;
  beerName: string;
  drinkType?: DrinkType;
  priceCzk?: number;
  volumeMl?: number;
  servingType?: ServingType;
  /** The shared evening, when there is one. */
  partyCode?: string | null;
  /** Persist immediately, but wait to deliver until a new table exists. */
  deferDelivery?: boolean;
  /** ISO-8601; defaults to now. */
  at?: string;
}): string {
  const id = generateUuidV4();
  const drankAt = at ?? new Date().toISOString();

  useTallyStore.getState().addDrink(
    {
      pubKey: place.pubKey,
      pubName: place.pubName,
      pubCity: place.pubCity,
      pubExternalId: place.pubExternalId,
      visitClientId: place.visitClientId,
      visitStartedAt: place.visitStartedAt,
    },
    { id, beerName, drinkType, priceCzk, volumeMl, servingType, at: drankAt },
  );
  // The private party record derives its stops from PubVisit, not from a drink's
  // display pub. Reuse the normal visit queue so moving pubs and offline nights
  // become real record stops without a second party-only write model.
  syncVisit(useTallyStore.getState().current, drankAt, partyCode, {
    deliver: !deferDelivery,
  });

  // A pub carries its identity; an evening that is not at a pub carries no
  // coordinates at all — never a guessed pub for a drink at somebody's flat.
  const outside = contextFromPubKey(place.pubKey);
  const where = outside
    ? { placeContext: outside }
    : {
        externalId: place.pubExternalId ?? null,
        name: place.pubName,
        city: place.pubCity,
        ...decodeGeohash8(place.pubKey),
      };

  const entry = buildDrinkEntry(
    {
      ...where,
      drinkType,
      beer: { name: beerName, priceCzk, volumeMl, servingType },
      drankAt,
      ...(partyCode ? { partyCode } : {}),
    },
    id,
  );
  void enqueueDrink(entry, { deliver: !deferDelivery }).then((delivered) => {
    if (delivered) useTallyStore.getState().markDrinkSynced(id);
  });

  return id;
}

/** Release first-write queues after the table create request has settled. */
export async function flushPartyBeerWrites(): Promise<void> {
  await Promise.all([flushDrinksQueue(), flushVisitsQueue()]);
}

function sessionContainingDrink(drinkId: string): TallySession | null {
  const { current, history } = useTallyStore.getState();
  if (current?.drinks.some((drink) => drink.id === drinkId)) return current;
  return history.find((session) => session.drinks.some((drink) => drink.id === drinkId)) ?? null;
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
  const session = sessionContainingDrink(drinkId);
  if (!session) return;
  const removed = useTallyStore
    .getState()
    .removeDrinkFromSession(session.startedAt, drinkId);
  if (!removed) return;

  void removeQueuedDrinkUpdate(drinkId);
  void removeQueuedDrink(drinkId).then((pulledFromQueue) => {
    if (pulledFromQueue) {
      // A newer undo timer may also have been holding older drinks. Once the
      // visible latest one is gone, release whatever remains.
      void flushDrinksQueue();
      return;
    }
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
export function renamePartyBeer(drinkId: string, beerName: string): void {
  const trimmed = beerName.trim();
  if (!trimmed) return;
  const session = sessionContainingDrink(drinkId);
  if (!session) return;
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

export function updatePartyDrink(
  drinkId: string,
  update: {
    beerName: string;
    drinkType: DrinkType;
    priceCzk?: number;
    volumeMl?: number;
    servingType?: ServingType;
  },
): void {
  const session = sessionContainingDrink(drinkId);
  if (!session) return;
  const changed = useTallyStore.getState().updateDrinkInSession(session.startedAt, drinkId, update);
  if (!changed) return;
  const wire = {
    beer_name: update.beerName.trim(),
    drink_type: update.drinkType,
    price_czk: update.priceCzk ?? null,
    volume_ml: update.volumeMl ?? null,
    serving_type: update.servingType ?? 'unknown',
  };
  void updateQueuedDrink(drinkId, wire).then((state) => {
    if (state === 'queued') return;
    if (state === 'in-flight') {
      // The initial POST already captured its old payload. Wait for it to
      // settle before PATCHing, otherwise a fast PATCH can arrive first and be
      // discarded as "not found".
      void flushDrinksQueue().then(() => enqueueDrinkUpdate({ client_id: drinkId, ...wire }));
      return;
    }
    void enqueueDrinkUpdate({ client_id: drinkId, ...wire });
  });
}
