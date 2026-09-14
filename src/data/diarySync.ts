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
import {
  contextPubKey,
  isContextPubKey,
  normalizeDrinkType,
  normalizePlaceContext,
} from '@/drinks/drinkTypes';
import {
  drinkingDayKey,
  type TallyDrink,
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

export interface ReconciledDiarySession {
  session: TallySession;
  source: 'local' | 'remote';
}

function wireDrinkToTallyDrink(drink: WireDrink): TallyDrink {
  return {
    id: drink.client_id,
    beerName: drink.beer.name,
    drinkType: normalizeDrinkType(drink.drink_type),
    ...(drink.beer.price_czk == null ? {} : { priceCzk: drink.beer.price_czk }),
    ...(drink.beer.volume_ml == null ? {} : { volumeMl: drink.beer.volume_ml }),
    ...(drink.beer.serving_type === 'unknown'
      ? {}
      : { servingType: drink.beer.serving_type }),
    at: drink.drank_at,
    syncStatus: 'sent',
  };
}

function validEpoch(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function sameDrinkingDay(first: string, second: string): boolean {
  const firstMs = validEpoch(first);
  const secondMs = validEpoch(second);
  if (firstMs === null || secondMs === null) return false;
  return drinkingDayKey(new Date(firstMs)) === drinkingDayKey(new Date(secondMs));
}

/**
 * Build the complete diary trail from the durable account snapshot, then lay
 * richer local sessions over it. The local store intentionally keeps a bounded
 * working set, so using it alone silently hid older visits and everything on a
 * freshly installed device.
 *
 * Old DrinkLog rows predate a direct visit/session foreign key. They are
 * matched to the visit at the same pub whose time window contains the drink;
 * genuinely unmatched rows are grouped by pub/context and drinking day so they
 * still remain visible instead of falling through the cracks.
 */
export function deriveReconciledDiarySessions(
  snapshot: DiarySnapshot | null,
  localSessions: TallySession[],
): ReconciledDiarySession[] {
  const sessions = new Map<string, ReconciledDiarySession>();
  const localDrinkIds = new Set<string>();

  for (const local of localSessions) {
    sessions.set(local.clientId, {
      session: { ...local, drinks: [...local.drinks] },
      source: 'local',
    });
    for (const drink of local.drinks) localDrinkIds.add(drink.id);
  }
  if (!snapshot) return Array.from(sessions.values());

  for (const visit of snapshot.visits) {
    if (sessions.has(visit.client_id)) continue;
    sessions.set(visit.client_id, {
      source: 'remote',
      session: {
        clientId: visit.client_id,
        pubKey: visit.cache_key,
        pubName: visit.name,
        ...(visit.city ? { pubCity: visit.city } : {}),
        ...(visit.external_id ? { pubExternalId: visit.external_id } : {}),
        startedAt: visit.started_at,
        drinks: [],
        archivedReason: 'manual',
        ...(visit.closed_at ? { closedAt: visit.closed_at } : {}),
      },
    });
  }

  const visitsByPub = new Map<string, WireVisit[]>();
  for (const visit of snapshot.visits) {
    const existing = visitsByPub.get(visit.cache_key) ?? [];
    existing.push(visit);
    visitsByPub.set(visit.cache_key, existing);
  }
  for (const visits of visitsByPub.values()) {
    visits.sort((a, b) => (validEpoch(b.started_at) ?? 0) - (validEpoch(a.started_at) ?? 0));
  }

  const unmatched = new Map<string, ReconciledDiarySession>();
  for (const drink of snapshot.drinks) {
    if (localDrinkIds.has(drink.client_id)) continue;

    const drinkMs = validEpoch(drink.drank_at);
    const candidates = drink.cache_key ? visitsByPub.get(drink.cache_key) ?? [] : [];
    const visit = candidates.find((candidate) => {
      const startMs = validEpoch(candidate.started_at);
      if (drinkMs === null || startMs === null || drinkMs < startMs) return false;
      const endMs = validEpoch(candidate.ended_at ?? candidate.closed_at);
      return endMs !== null ? drinkMs <= endMs : sameDrinkingDay(drink.drank_at, candidate.started_at);
    });

    if (visit) {
      const target = sessions.get(visit.client_id);
      if (target) {
        // Never mutate the Zustand-owned local object while deriving a view.
        if (target.source === 'local') {
          const cloned = { ...target.session, drinks: [...target.session.drinks] };
          sessions.set(visit.client_id, { ...target, session: cloned });
          cloned.drinks.push(wireDrinkToTallyDrink(drink));
        } else {
          target.session.drinks.push(wireDrinkToTallyDrink(drink));
        }
      }
      continue;
    }

    const context = normalizePlaceContext(drink.place_context);
    const pubKey = drink.cache_key ?? contextPubKey(context === 'pub' ? 'other' : context);
    const dayKey = validEpoch(drink.drank_at)
      ? drinkingDayKey(new Date(drink.drank_at))
      : drink.drank_at;

    // One pub, one drinking day = one evening. A drink that falls outside a
    // visit's time window (poured before it opened, or after it was closed)
    // used to spawn a second session for the same night, so the diary showed
    // the same evening twice with contradicting numbers. Attach it to the
    // evening that is already there — local first, it carries the richer row.
    const known = Array.from(sessions.values());
    const sameNight = (item: ReconciledDiarySession) =>
      item.session.pubKey === pubKey && sameDrinkingDay(item.session.startedAt, drink.drank_at);
    const matching =
      known.find((item) => item.source === 'local' && sameNight(item)) ?? known.find(sameNight);
    if (matching) {
      if (matching.source === 'local') {
        // Never mutate the Zustand-owned local object while deriving a view.
        const cloned = {
          ...matching.session,
          drinks: [...matching.session.drinks, wireDrinkToTallyDrink(drink)],
        };
        sessions.set(matching.session.clientId, { ...matching, session: cloned });
      } else {
        matching.session.drinks.push(wireDrinkToTallyDrink(drink));
      }
      continue;
    }

    const groupKey = `${pubKey}|${dayKey}`;
    let target = unmatched.get(groupKey);
    if (!target) {
      target = {
        source: 'remote',
        session: {
          // Drink IDs are UUIDs too, so the synthetic legacy session remains a
          // valid idempotency key if a future edit needs to sync its visit.
          clientId: drink.client_id,
          pubKey,
          pubName: drink.name,
          ...(drink.city ? { pubCity: drink.city } : {}),
          ...(drink.external_id ? { pubExternalId: drink.external_id } : {}),
          ...(context === 'pub' ? {} : { placeContext: context }),
          startedAt: drink.drank_at,
          drinks: [],
          archivedReason: 'manual',
        },
      };
      unmatched.set(groupKey, target);
    }
    target.session.drinks.push(wireDrinkToTallyDrink(drink));
    if ((validEpoch(drink.drank_at) ?? 0) < (validEpoch(target.session.startedAt) ?? 0)) {
      target.session.startedAt = drink.drank_at;
    }
  }

  for (const item of unmatched.values()) sessions.set(item.session.clientId, item);
  for (const item of sessions.values()) {
    item.session.drinks.sort((a, b) => (validEpoch(a.at) ?? 0) - (validEpoch(b.at) ?? 0));
  }

  return Array.from(sessions.values()).sort(
    (a, b) => (validEpoch(b.session.startedAt) ?? 0) - (validEpoch(a.session.startedAt) ?? 0),
  );
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
