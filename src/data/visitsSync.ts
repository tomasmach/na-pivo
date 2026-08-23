/**
 * Sync glue for pub visits ("evenings") — derives a wire VisitEntry from a local
 * TallySession and enqueues upserts/deletes, plus a one-time seed of existing
 * history.
 *
 * A visit is the EVENING itself (one TallySession), distinct from the per-beer
 * /v1/drinks rows. We push it whenever a session is created or changes (a new
 * beer bumps `ended_at`), so the backend always has the latest shape of the
 * sitting. The POST is idempotent on the session's `clientId`, so re-sending is
 * safe and the visitsQueue dedups repeated upserts for the same evening.
 *
 * Deriving lat/lng: a TallySession stores only the geohash-8 `pubKey`, so we
 * reconstruct a representative coordinate from the cell centre via
 * decodeGeohash8 — the server re-derives the SAME cache_key from it. `name` is
 * the session's pubName; `started_at` is the session start; `ended_at` is the
 * timestamp of the last counted beer, while `closed_at` marks an explicit local
 * session closure independently of that last sign of activity.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { decodeGeohash8 } from './geohash';
import { runPrivateAccountMutation } from './privateAccountBoundary';
import {
  enqueueVisitOp,
  flushVisitsQueue,
  type VisitEnqueueResult,
} from './visitsQueue';
import type { VisitEntry } from './visitsClient';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import { isContextPubKey } from '@/drinks/drinkTypes';

/** AsyncStorage flag guarding the one-time history seed. */
const SEEDED_KEY = 'na-pivo-visits-seeded';

/** The ISO timestamp of the last counted beer, or null when there are none. */
function lastDrinkAt(session: TallySession): string | null {
  if (session.drinks.length === 0) return null;
  let maxMs = -Infinity;
  let max: string | null = null;
  for (const drink of session.drinks) {
    const ms = Date.parse(drink.at);
    if (Number.isFinite(ms) && ms > maxMs) {
      maxMs = ms;
      max = drink.at;
    }
  }
  return max;
}

/** Build the wire VisitEntry for a session, or null when it has no clientId
 *  (defensive — every session minted/migrated under v1 has one) or when it is
 *  an outside evening — a `ctx:*` session is not a pub visit: decoding its key
 *  would fabricate coordinates, and drinking at home must never become a
 *  PubVisit (pub stats, párty rituals) server-side. */
export function buildVisitEntry(
  session: TallySession,
  updatedAt?: string,
  partyCode?: string | null,
): VisitEntry | null {
  if (!session.clientId) return null;
  if (isContextPubKey(session.pubKey)) return null;
  const { lat, lng } = decodeGeohash8(session.pubKey);
  const endedAt = lastDrinkAt(session);
  const entry: VisitEntry = {
    client_id: session.clientId,
    name: session.pubName,
    lat,
    lng,
    ...(session.pubCity ? { city: session.pubCity } : {}),
    ...(session.pubExternalId ? { external_id: session.pubExternalId } : {}),
    ...(partyCode ? { party_code: partyCode } : {}),
    started_at: session.startedAt,
    ended_at: endedAt,
    closed_at: session.closedAt ?? null,
    updated_at: updatedAt ?? session.closedAt ?? endedAt ?? session.startedAt,
  };
  return entry;
}

/**
 * Enqueue an upsert for one session. Call after each beer is counted (the
 * current session) so the backend tracks the evening as it grows. Resolves to
 * `storage-error` when the operation was not durably accepted; never throws.
 */
export type VisitSyncResult = VisitEnqueueResult | 'skipped';

export function syncVisit(
  session: TallySession | null,
  updatedAt?: string,
  partyCode?: string | null,
  options?: { deliver?: boolean },
): Promise<VisitSyncResult> {
  if (!session) return Promise.resolve('skipped');
  const entry = buildVisitEntry(session, updatedAt, partyCode);
  if (!entry) return Promise.resolve('skipped');
  const item = { op: 'upsert' as const, clientId: entry.client_id, entry };
  return (options ? enqueueVisitOp(item, options) : enqueueVisitOp(item)).catch(
    () => 'storage-error',
  );
}

/** Enqueue a delete for a removed evening. The result exposes storage failure and never throws. */
export function deleteVisitByClientId(clientId: string): Promise<VisitSyncResult> {
  if (!clientId) return Promise.resolve('skipped');
  return enqueueVisitOp({ op: 'delete', clientId }).catch(() => 'storage-error');
}

/**
 * One-time seed of every existing session in history (and the current one) into
 * the visits queue, guarded by an AsyncStorage flag so it runs exactly once per
 * install. Existing users predate visit-sync, so without this their past
 * evenings would never reach the backend. The backend is idempotent on
 * client_id, so even if the guard is lost this only re-sends, never duplicates.
 * Best-effort, never throws.
 */
async function seedVisitsFromHistoryWithinBoundary(): Promise<void> {
  try {
    const already = await AsyncStorage.getItem(SEEDED_KEY);
    if (already) return;
  } catch {
    // If the guard read fails, fall through; an extra idempotent re-send is safe.
  }

  const { current, history } = useTallyStore.getState();
  const sessions: TallySession[] = [];
  if (current && current.drinks.length > 0) sessions.push(current);
  sessions.push(...history);

  const enqueueOps: ReturnType<typeof enqueueVisitOp>[] = [];
  for (const session of sessions) {
    const entry = buildVisitEntry(session);
    if (entry) enqueueOps.push(enqueueVisitOp({ op: 'upsert', clientId: entry.client_id, entry }));
  }

  try {
    const results = await Promise.all(enqueueOps);
    if (results.some((result) => result === 'storage-error')) return;
  } catch {
    // Do not mark the seed as complete unless the visit ops were durably queued.
    return;
  }

  try {
    await AsyncStorage.setItem(SEEDED_KEY, '1');
  } catch {
    // Guard persist failed — worst case we re-seed next launch (idempotent).
  }

}

export async function seedVisitsFromHistory(): Promise<void> {
  try {
    await runPrivateAccountMutation(async () => seedVisitsFromHistoryWithinBoundary());
  } catch {
    // An account transition owns the seed marker/queues; its next-account
    // hydration can retry after the boundary reopens.
  }
  await flushVisitsQueue().catch(() => undefined);
}
