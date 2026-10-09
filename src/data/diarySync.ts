/**
 * Read-side reconciliation for account diary totals.
 *
 * Server rows are authoritative once present. Local tally rows are overlaid by
 * stable drink/visit client IDs, so offline additions remain visible without
 * counting records that already made it to the server twice. The diary also
 * takes the server's beer names, which the backend unifies across spellings.
 */

import { fetchDrinks, type WireDrink } from './drinksClient';
import { flushDrinksQueue } from './drinksQueue';
import { flushDeleteDrinksQueue, getQueuedDeleteIds } from './deleteDrinksQueue';
import { flushUpdateDrinksQueue, getQueuedUpdateIds } from './updateDrinksQueue';
import { fetchVisits, type WireVisit } from './visitsClient';
import { flushVisitsQueue, getQueuedVisitDeleteIds } from './visitsQueue';
import { isContextPubKey, normalizeDrinkType } from '@/drinks/drinkTypes';
import {
  allSessionsNewestFirst,
  useTallyStore,
  whenTallyHydrated,
  type TallySession,
} from '@/stores/tallyStore';

export interface DiarySnapshot {
  drinks: WireDrink[];
  visits: WireVisit[];
}

export interface ReconciledDiaryStats {
  totalBeers: number;
  distinctPubs: number;
  maxVisitsToOnePub: number;
  totalSpentCzk: number;
}

/** The beer name every local drink shows right now, by drink ID. */
function localBeerNames(): Map<string, string> {
  const { current, history } = useTallyStore.getState();
  const names = new Map<string, string>();
  for (const session of allSessionsNewestFirst(current, history)) {
    for (const drink of session.drinks) {
      if (normalizeDrinkType(drink.drinkType) === 'beer') names.set(drink.id, drink.beerName);
    }
  }
  return names;
}

/**
 * Server beer names for local drinks the server spells differently, e.g.
 * "Radek 12" that the backend stores as "Radegast Ryze Hořká 12°". A drink
 * with an edit still waiting to be sent keeps the user's name.
 */
function serverBeerNameFixes(
  drinks: WireDrink[],
  localNames: ReadonlyMap<string, string>,
  queuedUpdates: ReadonlySet<string>,
): Map<string, { from: string; to: string }> {
  const fixes = new Map<string, { from: string; to: string }>();
  for (const drink of drinks) {
    const from = localNames.get(drink.client_id);
    const to = drink.beer.name.trim();
    if (
      from === undefined ||
      !to ||
      to === from ||
      drink.drink_type !== 'beer' ||
      queuedUpdates.has(drink.client_id)
    ) {
      continue;
    }
    fixes.set(drink.client_id, { from, to });
  }
  return fixes;
}

/** Flush pending writes first, then pull both authoritative account snapshots. */
export async function reconcileDiarySnapshot(): Promise<DiarySnapshot | null> {
  // Read before the fetch: a drink renamed while it runs no longer matches and
  // keeps the new name. A launch pull must not read a diary still loading.
  await whenTallyHydrated();
  const localNames = localBeerNames();
  // An edit queued now may land after the snapshot was read; it keeps its name.
  const updatesBefore = await getQueuedUpdateIds();
  await Promise.all([
    flushDrinksQueue(),
    flushDeleteDrinksQueue(),
    flushUpdateDrinksQueue(),
    flushVisitsQueue(),
  ]);

  const [drinks, visits] = await Promise.all([fetchDrinks(), fetchVisits()]);
  if (!drinks || !visits) return null;
  // A removed drink or wiped evening stays on the server until its queued
  // deletion gets through (offline, throttled); it is already gone locally.
  const [pendingDrinkDeletes, pendingVisitDeletes, pendingDrinkUpdates] = await Promise.all([
    getQueuedDeleteIds(),
    getQueuedVisitDeleteIds(),
    getQueuedUpdateIds(),
  ]);
  const editedDrinks = new Set([...updatesBefore, ...pendingDrinkUpdates]);
  useTallyStore.getState().adoptServerBeerNames(serverBeerNameFixes(drinks, localNames, editedDrinks));
  return {
    drinks: drinks.filter((drink) => !pendingDrinkDeletes.has(drink.client_id)),
    visits: visits.filter((visit) => !pendingVisitDeletes.has(visit.client_id)),
  };
}

/**
 * Merge a server snapshot with the local tally. Remote suspect rows stay out of
 * profile totals, matching the backend profile contract. A matching local ID is
 * already represented remotely; only genuinely local-only rows are added.
 */
export function deriveReconciledDiaryStats(
  snapshot: DiarySnapshot,
  localSessions: TallySession[],
): ReconciledDiaryStats {
  const remoteDrinkIds = new Set(snapshot.drinks.map((drink) => drink.client_id));
  const remoteVisitIds = new Set(snapshot.visits.map((visit) => visit.client_id));
  const pubKeys = new Set<string>();
  const visitsPerPub = new Map<string, number>();
  let totalBeers = 0;
  let totalSpentCzk = 0;

  for (const drink of snapshot.drinks) {
    if (drink.is_suspect) continue;
    if (normalizeDrinkType(drink.drink_type) === 'beer') totalBeers += 1;
    totalSpentCzk += drink.beer.price_czk ?? 0;
    if (drink.cache_key) pubKeys.add(drink.cache_key);
  }

  for (const visit of snapshot.visits) {
    if (!visit.cache_key) continue;
    pubKeys.add(visit.cache_key);
    visitsPerPub.set(visit.cache_key, (visitsPerPub.get(visit.cache_key) ?? 0) + 1);
  }

  for (const session of localSessions) {
    const atPub = !isContextPubKey(session.pubKey);
    if (atPub) pubKeys.add(session.pubKey);
    if (atPub && !remoteVisitIds.has(session.clientId)) {
      visitsPerPub.set(session.pubKey, (visitsPerPub.get(session.pubKey) ?? 0) + 1);
    }
    for (const drink of session.drinks) {
      if (remoteDrinkIds.has(drink.id)) continue;
      if (normalizeDrinkType(drink.drinkType) === 'beer') totalBeers += 1;
      totalSpentCzk += drink.priceCzk ?? 0;
    }
  }

  let maxVisitsToOnePub = 0;
  for (const count of visitsPerPub.values()) maxVisitsToOnePub = Math.max(maxVisitsToOnePub, count);

  return {
    totalBeers,
    distinctPubs: pubKeys.size,
    maxVisitsToOnePub,
    totalSpentCzk,
  };
}
