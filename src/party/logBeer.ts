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
  isDrinkQueued,
  updateQueuedDrink,
  updateQueuedDrinkBeerName,
} from '@/data/drinksQueue';
import { createQueueLock } from '@/data/createQueue';
import { isPrivateAccountMutationScopeCurrent, runPrivateAccountMutation } from '@/data/privateAccountBoundary';
import { enqueueDrinkUpdate } from '@/data/updateDrinksQueue';
import { prepareDrinkDeletion } from '@/data/drinkDeletion';
import { decodeGeohash8 } from '@/data/geohash';
import { deleteVisitByClientId, syncVisit } from '@/data/visitsSync';
import { flushVisitsQueue } from '@/data/visitsQueue';
import { isPastEveningBackdate, useTallyStore, type TallySession } from '@/stores/tallyStore';
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

// Keep local additions ordered; the account lease is captured before this lock.
const runAddition = createQueueLock({ protectPrivateAccount: false });

/**
 * Count one, from the hub.
 *
 * Returns the drink's client id, which is also its id everywhere else: in the
 * session, in the queue, on the server. One id, so taking it back later is a
 * lookup rather than a guess. Returns null when local persistence fails.
 */
export async function logPartyBeer({
  place,
  beerName,
  drinkType = 'beer',
  priceCzk,
  volumeMl,
  servingType,
  partyCode,
  deferDelivery = false,
  at,
  backdated = false,
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
  /** True only when the user explicitly selected an earlier time. */
  backdated?: boolean;
}): Promise<string | null> {
  const id = generateUuidV4();
  const drankAt = at ?? new Date().toISOString();
  // A backdate edits the private diary. It must never leak into the table that
  // happens to be active now (the Counter follows the same invariant).
  const activePartyCode = backdated ? null : partyCode;

  const tallyPlace = {
    pubKey: place.pubKey,
    pubName: place.pubName,
    pubCity: place.pubCity,
    pubExternalId: place.pubExternalId,
    visitClientId: place.visitClientId,
    visitStartedAt: place.visitStartedAt,
  };
  const tallyDrink = {
    id,
    beerName,
    drinkType,
    priceCzk,
    volumeMl,
    servingType,
    at: drankAt,
  };
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
      ...(activePartyCode ? { partyCode: activePartyCode } : {}),
    },
    id,
  );
  return runPrivateAccountMutation((scope) => runAddition(async () => {
    if (!isPrivateAccountMutationScopeCurrent(scope)) return null;
    if ((await enqueueDrink(entry, { deliver: false })) === 'storage-error') return null;
    if (!isPrivateAccountMutationScopeCurrent(scope)) return null;
    const before = useTallyStore.getState();
    let landedSession: TallySession | null;
    if (backdated && isPastEveningBackdate(drankAt)) {
      landedSession = before.addBackdatedDrink(tallyPlace, tallyDrink);
    } else {
      before.addDrink(tallyPlace, tallyDrink);
      landedSession = useTallyStore.getState().current;
    }
    // The drink is durable now. A failed visit must not undo it or overwrite
    // another edit made while local storage was pending.
    await syncVisit(landedSession, drankAt, activePartyCode, {
      deliver: false,
    });
    if (!isPrivateAccountMutationScopeCurrent(scope)) return null;
    if (!deferDelivery) {
      void flushPartyBeerWrites().then(async () => {
        if (!isPrivateAccountMutationScopeCurrent(scope)) return;
        const queued = await isDrinkQueued(id);
        if (!queued && isPrivateAccountMutationScopeCurrent(scope)) {
          useTallyStore.getState().markDrinkSynced(id);
        }
      }).catch(() => undefined);
    }
    return id;
  })).catch(() => null);
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
export async function unlogPartyBeer(
  drinkId: string,
): Promise<'removed' | 'missing' | 'storage-error'> {
  const session = sessionContainingDrink(drinkId);
  if (!session) return 'missing';
  const deletion = await prepareDrinkDeletion(drinkId);
  if (deletion === 'storage-error') return 'storage-error';
  const pulledFromQueue = deletion === 'local-create-removed';
  const wasCurrent = useTallyStore.getState().current?.startedAt === session.startedAt;
  const removed = useTallyStore.getState().removeDrinkFromSession(session.startedAt, drinkId);
  if (!removed) return 'missing';
  if (!wasCurrent && removed.remainingDrinks === 0) {
    // addBackdatedDrink can mint a one-drink historical visit. Undo must replace
    // its queued upsert with a delete, otherwise it would sync as an empty night.
    void deleteVisitByClientId(removed.sessionClientId);
  }
  if (pulledFromQueue) void flushDrinksQueue();
  return 'removed';
}

/**
 * Fix what it was called.
 *
 * The log is the only place you can see WHICH beer was logged wrong, so it is
 * where correcting it belongs. Renaming never touches the price, the pub or the
 * time — those were right, the name was a typo.
 */
export async function renamePartyBeer(
  drinkId: string,
  beerName: string,
): Promise<'updated' | 'missing' | 'storage-error'> {
  const trimmed = beerName.trim();
  if (!trimmed) return 'missing';
  const session = sessionContainingDrink(drinkId);
  if (!session) return 'missing';
  const state = await updateQueuedDrinkBeerName(drinkId, trimmed);
  if (state !== 'queued') {
    if (state === 'in-flight' || state === 'storage-error') await flushDrinksQueue();
    if (
      (await enqueueDrinkUpdate({ client_id: drinkId, beer_name: trimmed })) === 'storage-error'
    ) {
      return 'storage-error';
    }
  }
  const changed = useTallyStore
    .getState()
    .updateDrinkNameInSession(session.startedAt, drinkId, trimmed);
  return changed ? 'updated' : 'missing';
}

export async function updatePartyDrink(
  drinkId: string,
  update: {
    beerName: string;
    drinkType: DrinkType;
    priceCzk?: number;
    volumeMl?: number;
    servingType?: ServingType;
  },
): Promise<'updated' | 'missing' | 'storage-error'> {
  const session = sessionContainingDrink(drinkId);
  if (!session) return 'missing';
  const wire = {
    beer_name: update.beerName.trim(),
    drink_type: update.drinkType,
    price_czk: update.priceCzk ?? null,
    volume_ml: update.volumeMl ?? null,
    serving_type: update.servingType ?? 'unknown',
  };
  const state = await updateQueuedDrink(drinkId, wire);
  if (state !== 'queued') {
    if (state === 'in-flight' || state === 'storage-error') await flushDrinksQueue();
    if ((await enqueueDrinkUpdate({ client_id: drinkId, ...wire })) === 'storage-error') {
      return 'storage-error';
    }
  }
  const changed = useTallyStore.getState().updateDrinkInSession(session.startedAt, drinkId, update);
  return changed ? 'updated' : 'missing';
}
