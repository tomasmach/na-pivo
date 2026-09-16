/**
 * Read-side reconciliation for account diary totals.
 *
 * Server rows are authoritative once present. Local tally rows are overlaid by
 * stable drink/visit client IDs, so offline additions remain visible without
 * counting records that already made it to the server twice.
 */

import { fetchDrinks, type WireDrink } from './drinksClient';
import { flushDrinksQueue } from './drinksQueue';
import { flushDeleteDrinksQueue } from './deleteDrinksQueue';
import { flushUpdateDrinksQueue } from './updateDrinksQueue';
import { fetchVisits, type WireVisit } from './visitsClient';
import { flushVisitsQueue } from './visitsQueue';
import { isContextPubKey, normalizeDrinkType } from '@/drinks/drinkTypes';
import type { TallySession } from '@/stores/tallyStore';

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

/** Flush pending writes first, then pull both authoritative account snapshots. */
export async function reconcileDiarySnapshot(): Promise<DiarySnapshot | null> {
  await Promise.all([
    flushDrinksQueue(),
    flushDeleteDrinksQueue(),
    flushUpdateDrinksQueue(),
    flushVisitsQueue(),
  ]);

  const [drinks, visits] = await Promise.all([fetchDrinks(), fetchVisits()]);
  if (!drinks || !visits) return null;
  return { drinks, visits };
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
