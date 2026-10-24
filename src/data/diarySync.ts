/**
 * Read-side reconciliation for account diary totals, plus a one-time restore
 * of the account's server history into the local diary after sign-in.
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
import {
  contextFromPubKey,
  contextPubKey,
  isContextPubKey,
  normalizeDrinkType,
  normalizePlaceContext,
} from '@/drinks/drinkTypes';
import { t } from '@/i18n';
import { useCommunityStore } from '@/stores/communityStore';
import {
  allSessionsNewestFirst,
  drinkingDayKey,
  MAX_HISTORY,
  sessionIsRestoredOnly,
  sortSessionsNewestFirst,
  useTallyStore,
  whenTallyHydrated,
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

interface LocalBeer {
  name: string;
  /** The pub's cell; null outside a pub. */
  cell: string | null;
}

interface BeerNameFix {
  from: string;
  to: string;
  cell: string | null;
}

/** The beer name every local drink shows right now, by drink ID. */
function localBeerNames(): Map<string, LocalBeer> {
  const { current, history } = useTallyStore.getState();
  const names = new Map<string, LocalBeer>();
  for (const session of allSessionsNewestFirst(current, history)) {
    const cell = isContextPubKey(session.pubKey) ? null : session.pubKey;
    for (const drink of session.drinks) {
      if (normalizeDrinkType(drink.drinkType) === 'beer') {
        names.set(drink.id, { name: drink.beerName, cell });
      }
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
  localNames: ReadonlyMap<string, LocalBeer>,
  queuedUpdates: ReadonlySet<string>,
): Map<string, BeerNameFix> {
  const fixes = new Map<string, BeerNameFix>();
  for (const drink of drinks) {
    const local = localNames.get(drink.client_id);
    const to = drink.beer.name.trim();
    if (
      local === undefined ||
      !to ||
      to === local.name ||
      drink.drink_type !== 'beer' ||
      queuedUpdates.has(drink.client_id)
    ) {
      continue;
    }
    fixes.set(drink.client_id, { from: local.name, to, cell: local.cell });
  }
  return fixes;
}

/** The pub's local menu copy follows, so the counter lists each beer once. */
function renameLocalMenus(fixes: ReadonlyMap<string, BeerNameFix>): void {
  const byCell = new Map<string, Map<string, string>>();
  for (const { from, to, cell } of fixes.values()) {
    if (!cell) continue;
    const names = byCell.get(cell) ?? new Map<string, string>();
    names.set(from, to);
    byCell.set(cell, names);
  }
  const { renameOverrideBeers } = useCommunityStore.getState();
  byCell.forEach((names, cell) => renameOverrideBeers(cell, names));
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
  const fixes = serverBeerNameFixes(drinks, localNames, editedDrinks);
  useTallyStore.getState().adoptServerBeerNames(fixes);
  renameLocalMenus(fixes);
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
    // The server has no visit for this restored evening; restoring must not add one.
    if (atPub && !remoteVisitIds.has(session.clientId) && !sessionIsRestoredOnly(session)) {
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

function epochMs(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function isoOrUndefined(iso: string | null | undefined): string | undefined {
  const ms = epochMs(iso);
  return ms === null ? undefined : new Date(ms).toISOString();
}

function restoredDrink(drink: WireDrink, atMs: number): TallyDrink {
  const restored: TallyDrink = {
    id: drink.client_id,
    beerName: drink.beer.name,
    at: new Date(atMs).toISOString(),
    syncStatus: 'sent',
    restored: true,
  };
  const drinkType = normalizeDrinkType(drink.drink_type);
  if (drinkType !== 'beer') restored.drinkType = drinkType;
  if (typeof drink.beer.price_czk === 'number') restored.priceCzk = drink.beer.price_czk;
  if (typeof drink.beer.volume_ml === 'number') restored.volumeMl = drink.beer.volume_ml;
  if (drink.beer.serving_type !== 'unknown') restored.servingType = drink.beer.serving_type;
  return restored;
}

interface VisitWindow {
  visit: WireVisit;
  startMs: number;
  endMs: number | null;
  day: string;
}

function visitWindow(visit: WireVisit): VisitWindow | null {
  const startMs = epochMs(visit.started_at);
  if (startMs === null) return null;
  return {
    visit,
    startMs,
    endMs: epochMs(visit.ended_at) ?? epochMs(visit.closed_at),
    day: drinkingDayKey(new Date(startMs)),
  };
}

function latestStart<T extends { startMs: number }>(items: T[]): T | null {
  return items.reduce<T | null>((best, item) => (!best || item.startMs > best.startMs ? item : best), null);
}

/**
 * The visit a pub drink was poured in. The pub-visits read returns repaired pub
 * identities and the drinks read does not, so a drink whose pub has no visit
 * that day may belong to a same-day visit keyed by the repaired pub.
 */
function visitOfDrink(
  windows: VisitWindow[],
  cacheKey: string | null,
  atMs: number,
  day: string,
): VisitWindow | null {
  const sameDay = windows.filter((window) => window.day === day);
  const containing = sameDay.filter(
    (window) => window.startMs <= atMs && (window.endMs === null || atMs <= window.endMs),
  );
  const samePub = containing.filter((window) => window.visit.cache_key === cacheKey);
  if (samePub.length > 0) return latestStart(samePub);
  if (sameDay.some((window) => window.visit.cache_key === cacheKey)) return null;
  return latestStart(containing);
}

function sessionFromVisit(visit: WireVisit, startMs: number): TallySession {
  const closedAt = isoOrUndefined(visit.closed_at);
  const visitUpdatedAt = isoOrUndefined(visit.updated_at);
  return {
    clientId: visit.client_id,
    pubKey: visit.cache_key,
    pubName: visit.name,
    ...(visit.city ? { pubCity: visit.city } : {}),
    ...(visit.external_id ? { pubExternalId: visit.external_id } : {}),
    startedAt: new Date(startMs).toISOString(),
    drinks: [],
    archivedReason: closedAt ? 'manual' : 'timeout',
    ...(closedAt ? { closedAt } : {}),
    ...(visitUpdatedAt ? { visitUpdatedAt } : {}),
  };
}

function sessionFromDrink(drink: WireDrink, pubKey: string, startedAt: string): TallySession {
  const outside = contextFromPubKey(pubKey);
  return {
    clientId: drink.client_id,
    pubKey,
    pubName: outside ? t.counter.outsideLabel(outside) : drink.name,
    ...(!outside && drink.city ? { pubCity: drink.city } : {}),
    ...(!outside && drink.external_id ? { pubExternalId: drink.external_id } : {}),
    ...(outside ? { placeContext: outside } : {}),
    startedAt,
    drinks: [],
    archivedReason: 'manual',
  };
}

interface Draft {
  session: TallySession;
  local: boolean;
  changed: boolean;
}

function addToDraft(draft: Draft, drink: TallyDrink): void {
  if (!draft.changed) {
    draft.session = { ...draft.session, drinks: [...draft.session.drinks] };
    draft.changed = true;
  }
  draft.session.drinks.push(drink);
  if (Date.parse(drink.at) < Date.parse(draft.session.startedAt)) draft.session.startedAt = drink.at;
}

/** The evening at the same place on the same drinking day, preferring the one
 *  that started last before the drink. */
function sameNightDraft(drafts: Draft[], pubKey: string, day: string, atMs: number): Draft | null {
  const candidates = drafts
    .map((draft) => ({ draft, startMs: epochMs(draft.session.startedAt) }))
    .filter(
      (item): item is { draft: Draft; startMs: number } =>
        item.draft.session.pubKey === pubKey &&
        item.startMs !== null &&
        drinkingDayKey(new Date(item.startMs)) === day,
    );
  const before = latestStart(candidates.filter((item) => item.startMs <= atMs));
  if (before) return before.draft;
  return candidates.sort((a, b) => a.startMs - b.startMs)[0]?.draft ?? null;
}

/**
 * Add the account's server history to the local diary, grouped into evenings
 * the way the counter groups them. Returns the new history, or null when
 * nothing changes. `current` is never touched: drinks of its visit stay out and
 * no restored drink joins it. Restored evenings only fill free history slots,
 * so no local evening is evicted.
 */
export function mergeServerDiaryHistory(
  snapshot: DiarySnapshot,
  current: TallySession | null,
  history: TallySession[],
): TallySession[] | null {
  const localDrinkIds = new Set<string>();
  for (const session of current ? [current, ...history] : history) {
    for (const drink of session.drinks) localDrinkIds.add(drink.id);
  }

  const serverDrinks = new Map<string, { drink: WireDrink; atMs: number; day: string }>();
  for (const drink of snapshot.drinks) {
    const atMs = epochMs(drink.drank_at);
    if (atMs === null || localDrinkIds.has(drink.client_id) || serverDrinks.has(drink.client_id)) continue;
    serverDrinks.set(drink.client_id, { drink, atMs, day: drinkingDayKey(new Date(atMs)) });
  }
  if (serverDrinks.size === 0) return null;
  const byTime = [...serverDrinks.values()].sort((a, b) => a.atMs - b.atMs);

  const drafts: Draft[] = history.map((session) => ({ session, local: true, changed: false }));
  const draftsByVisit = new Map(drafts.map((draft) => [draft.session.clientId, draft]));
  const windows = snapshot.visits
    .map(visitWindow)
    .filter((window): window is VisitWindow => window !== null);

  const withoutVisit: typeof byTime = [];
  for (const item of byTime) {
    const { drink, atMs, day } = item;
    const atPub = normalizePlaceContext(drink.place_context) === 'pub';
    const window = atPub ? visitOfDrink(windows, drink.cache_key, atMs, day) : null;
    if (!window) {
      withoutVisit.push(item);
      continue;
    }
    if (window.visit.client_id === current?.clientId) continue;
    let draft = draftsByVisit.get(window.visit.client_id);
    if (!draft) {
      draft = { session: sessionFromVisit(window.visit, window.startMs), local: false, changed: true };
      draftsByVisit.set(window.visit.client_id, draft);
      drafts.push(draft);
    }
    addToDraft(draft, restoredDrink(drink, atMs));
  }

  for (const { drink, atMs, day } of withoutVisit) {
    const context = normalizePlaceContext(drink.place_context);
    const pubKey =
      context === 'pub' && drink.cache_key
        ? drink.cache_key
        : contextPubKey(context === 'pub' ? 'other' : context);
    const restored = restoredDrink(drink, atMs);
    let draft = sameNightDraft(drafts, pubKey, day, atMs);
    if (!draft) {
      draft = { session: sessionFromDrink(drink, pubKey, restored.at), local: false, changed: true };
      drafts.push(draft);
    }
    addToDraft(draft, restored);
  }

  const freeSlots = Math.max(0, MAX_HISTORY - history.length);
  const added = sortSessionsNewestFirst(
    drafts.filter((draft) => !draft.local && draft.session.drinks.length > 0).map((draft) => draft.session),
  ).slice(0, freeSlots);
  if (added.length === 0 && !drafts.some((draft) => draft.local && draft.changed)) return null;

  for (const draft of drafts) {
    if (draft.changed) draft.session.drinks.sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0));
  }
  return sortSessionsNewestFirst([
    ...drafts.filter((draft) => draft.local).map((draft) => draft.session),
    ...added,
  ]);
}

/**
 * Take over the account's server history once per account, so a diary emptied
 * by logout or a new install shows the account's evenings again. Restored
 * drinks are marked as already on the server; nothing is uploaded.
 */
export function restoreAccountDiary(snapshot: DiarySnapshot, accountId: string): void {
  const { current, history, restoredAccountId } = useTallyStore.getState();
  if (restoredAccountId === accountId) return;
  const restored = mergeServerDiaryHistory(snapshot, current, history);
  useTallyStore.setState(
    restored ? { history: restored, restoredAccountId: accountId } : { restoredAccountId: accountId },
  );
}
