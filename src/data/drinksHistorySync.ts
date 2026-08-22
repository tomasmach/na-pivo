/**
 * One-time bridge for installs whose local tally predates /v1/drinks sync.
 *
 * Every TallyDrink already has the stable UUID later used as client_id, so old
 * diary rows can safely be replayed through the normal persistent drinks queue.
 * The backend's per-account client_id uniqueness makes retries idempotent.
 *
 * Unlike a normal count, a migration can contain more than the queue's hard cap
 * and the API permits only 30 drink writes/minute. We therefore send at most 20
 * historical IDs per wave (leaving headroom for live counting), persist progress,
 * and schedule a fresh snapshot after the throttle window. We only stamp the
 * guard after every ID has left the queue. A retryable network result, storage
 * failure, full queue, or account-boundary cancellation leaves the guard unset.
 * A permanent API rejection counts as processed, matching the queue contract.
 */

import AsyncStorage from './privateAccountStorage';

import { buildDrinkEntry, type DrinkEntry } from './drinksClient';
import {
  ensureHistoricalDrinkBatchQueued,
  flushDrinksQueue,
  getDrinksQueueBoundaryGeneration,
  getQueuedDrinkIds,
  releaseHistoricalDrinkBatch,
} from './drinksQueue';
import { decodeGeohash8, geohash8 } from './geohash';
import {
  contextFromPubKey,
  isContextPubKey,
  isServingType,
  normalizeDrinkType,
  normalizePlaceContext,
} from '@/drinks/drinkTypes';
import {
  useTallyStore,
  type TallyDrink,
  type TallySession,
} from '@/stores/tallyStore';

export const DRINKS_HISTORY_SEEDED_KEY = 'na-pivo-drinks-history-seeded-v1';
export const DRINKS_HISTORY_PROGRESS_KEY = 'na-pivo-drinks-history-progress-v1';
const SEED_WAVE_SIZE = 20;
const SEED_WAVE_INTERVAL_MS = 61_000;

let cancellationGeneration = 0;
let seedPromise: Promise<void> | null = null;
let nextWaveNotBeforeMs = 0;
let scheduledWave: ReturnType<typeof setTimeout> | null = null;

async function waitForTallyHydration(): Promise<void> {
  const persist = useTallyStore.persist;
  if (persist.hasHydrated()) return;

  await new Promise<void>((resolve) => {
    const unsubscribe = persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });

    if (persist.hasHydrated()) {
      unsubscribe();
      resolve();
    } else {
      void persist.rehydrate();
    }
  });
}

/**
 * Reconstruct the exact queue payload a tally drink would have produced when it
 * was first counted. Pub coordinates are the geohash cell centre (not raw GPS);
 * outside sessions deliberately contain no pub identity or coordinates.
 */
export function buildHistoricalDrinkEntry(
  session: TallySession,
  drink: TallyDrink,
): DrinkEntry | null {
  if (
    typeof drink.id !== 'string' ||
    !drink.id ||
    typeof drink.beerName !== 'string' ||
    !drink.beerName.trim() ||
    typeof drink.at !== 'string' ||
    !Number.isFinite(Date.parse(drink.at))
  ) {
    return null;
  }

  const contextFromKey = contextFromPubKey(session.pubKey);
  const placeContext = contextFromKey ?? normalizePlaceContext(session.placeContext);
  const outside = placeContext !== 'pub';
  let coordinates: { lat: number; lng: number } | null = null;

  if (!outside) {
    if (
      isContextPubKey(session.pubKey) ||
      typeof session.pubName !== 'string' ||
      !session.pubName.trim() ||
      typeof drink.priceCzk !== 'number' ||
      !Number.isFinite(drink.priceCzk)
    ) {
      return null;
    }
    coordinates = decodeGeohash8(session.pubKey);
    if (session.pubKey.length !== 8 || geohash8(coordinates.lat, coordinates.lng) !== session.pubKey) {
      return null;
    }
  }

  return buildDrinkEntry(
    {
      placeContext,
      ...(coordinates
        ? {
            name: session.pubName,
            lat: coordinates.lat,
            lng: coordinates.lng,
            ...(session.pubCity ? { city: session.pubCity } : {}),
            ...(session.pubExternalId ? { externalId: session.pubExternalId } : {}),
          }
        : {}),
      drinkType: normalizeDrinkType(drink.drinkType),
      beer: {
        name: drink.beerName,
        ...(typeof drink.priceCzk === 'number' && Number.isFinite(drink.priceCzk)
          ? { priceCzk: drink.priceCzk }
          : {}),
        ...(typeof drink.volumeMl === 'number' && Number.isFinite(drink.volumeMl)
          ? { volumeMl: drink.volumeMl }
          : {}),
        ...(isServingType(drink.servingType) ? { servingType: drink.servingType } : {}),
      },
      drankAt: drink.at,
    },
    drink.id,
  );
}

function snapshotHistoricalEntries(): DrinkEntry[] | null {
  const { current, history } = useTallyStore.getState();
  const sessions = current ? [current, ...history] : history;
  const byClientId = new Map<string, DrinkEntry>();

  for (const session of sessions) {
    for (const drink of session.drinks) {
      const entry = buildHistoricalDrinkEntry(session, drink);
      // A malformed legacy row cannot be silently skipped and then hidden by
      // the guard. Leave the seed retryable in case a later migration repairs it.
      if (!entry) return null;
      if (!byClientId.has(entry.client_id)) byClientId.set(entry.client_id, entry);
    }
  }
  return [...byClientId.values()];
}

interface HistorySeedProgress {
  clientIds: Set<string>;
  nextWaveAt: number;
}

function parseProgress(raw: string | null): HistorySeedProgress {
  if (!raw) return { clientIds: new Set(), nextWaveAt: 0 };
  try {
    const parsed = JSON.parse(raw) as { clientIds?: unknown; nextWaveAt?: unknown };
    const clientIds = Array.isArray(parsed.clientIds)
      ? new Set(
          parsed.clientIds.filter(
            (value): value is string => typeof value === 'string' && !!value,
          ),
        )
      : new Set<string>();
    const nextWaveAt =
      typeof parsed.nextWaveAt === 'number' && Number.isFinite(parsed.nextWaveAt)
        ? parsed.nextWaveAt
        : 0;
    return { clientIds, nextWaveAt };
  } catch {
    return { clientIds: new Set(), nextWaveAt: 0 };
  }
}

function scheduleNextWave(
  cancellationAtSchedule: number,
  queueBoundaryAtSchedule: number,
): void {
  if (scheduledWave) return;
  const delay = Math.max(0, nextWaveNotBeforeMs - Date.now());
  scheduledWave = setTimeout(() => {
    scheduledWave = null;
    if (
      cancellationAtSchedule !== cancellationGeneration ||
      queueBoundaryAtSchedule !== getDrinksQueueBoundaryGeneration()
    ) {
      return;
    }
    // Rehydrate/re-snapshot in a new run; never retain an old private-history
    // payload across the minute-long throttle window.
    void seedDrinksFromHistory();
  }, delay);
}

async function runHistorySeed(): Promise<void> {
  const cancellationAtStart = cancellationGeneration;
  const queueBoundaryAtStart = getDrinksQueueBoundaryGeneration();

  await waitForTallyHydration();
  if (cancellationAtStart !== cancellationGeneration) return;

  // Retry already-queued drinks even after the one-time history seed completed.
  // Root startup delegates this queue here so the same coalescer is not invoked
  // once from the seed and once from the generic launch sweep.
  await flushDrinksQueue();
  if (cancellationAtStart !== cancellationGeneration) return;

  try {
    if (await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)) return;
  } catch {
    // A failed read may cause harmless idempotent replays, but must not prevent
    // recovery of old local drinks.
  }

  let progress: HistorySeedProgress;
  try {
    progress = parseProgress(await AsyncStorage.getItem(DRINKS_HISTORY_PROGRESS_KEY));
  } catch {
    progress = { clientIds: new Set(), nextWaveAt: 0 };
  }
  nextWaveNotBeforeMs = Math.max(nextWaveNotBeforeMs, progress.nextWaveAt);
  if (Date.now() < nextWaveNotBeforeMs) {
    scheduleNextWave(cancellationAtStart, queueBoundaryAtStart);
    return;
  }

  const entries = snapshotHistoricalEntries();
  if (!entries) return;
  const processed = progress.clientIds;
  const remaining = entries.filter((entry) => !processed.has(entry.client_id));

  if (remaining.length > 0) {
    const batch = remaining.slice(0, SEED_WAVE_SIZE);
    const result = await ensureHistoricalDrinkBatchQueued(batch, queueBoundaryAtStart);
    if (!result.boundaryMatches) return;
    if (
      cancellationAtStart !== cancellationGeneration ||
      queueBoundaryAtStart !== getDrinksQueueBoundaryGeneration()
    ) {
      releaseHistoricalDrinkBatch(result.acceptedClientIds);
      return;
    }
    // Full queue/storage failure: defer to a later lifecycle. Do not spin and
    // do not start a throttle timer because no historical POST was attempted.
    if (result.acceptedClientIds.length === 0) return;

    try {
      await flushDrinksQueue();
      if (
        cancellationAtStart !== cancellationGeneration ||
        queueBoundaryAtStart !== getDrinksQueueBoundaryGeneration()
      ) {
        return;
      }

      // Even duplicate/idempotent requests consume API throttle capacity.
      nextWaveNotBeforeMs = Date.now() + SEED_WAVE_INTERVAL_MS;
      const pending = await getQueuedDrinkIds(result.acceptedClientIds);
      if (pending.length > 0) {
        const pendingMarker = JSON.stringify({
          clientIds: [...processed],
          nextWaveAt: nextWaveNotBeforeMs,
        });
        try {
          await AsyncStorage.setItem(DRINKS_HISTORY_PROGRESS_KEY, pendingMarker);
          if (
            cancellationAtStart !== cancellationGeneration ||
            queueBoundaryAtStart !== getDrinksQueueBoundaryGeneration()
          ) {
            if ((await AsyncStorage.getItem(DRINKS_HISTORY_PROGRESS_KEY)) === pendingMarker) {
              await AsyncStorage.removeItem(DRINKS_HISTORY_PROGRESS_KEY);
            }
          }
        } catch {
          // Retryable queue rows remain durable; the guard stays unset.
        }
        return;
      }

      for (const clientId of result.acceptedClientIds) processed.add(clientId);
      const progressMarker = JSON.stringify({
        clientIds: [...processed],
        nextWaveAt: nextWaveNotBeforeMs,
      });
      try {
        await AsyncStorage.setItem(DRINKS_HISTORY_PROGRESS_KEY, progressMarker);
      } catch {
        scheduleNextWave(cancellationAtStart, queueBoundaryAtStart);
        return;
      }
      if (
        cancellationAtStart !== cancellationGeneration ||
        queueBoundaryAtStart !== getDrinksQueueBoundaryGeneration()
      ) {
        try {
          if ((await AsyncStorage.getItem(DRINKS_HISTORY_PROGRESS_KEY)) === progressMarker) {
            await AsyncStorage.removeItem(DRINKS_HISTORY_PROGRESS_KEY);
          }
        } catch {
          // clearLocalPrivateAccountData also removes the key.
        }
        return;
      }
      if (!result.persisted) return;
    } finally {
      releaseHistoricalDrinkBatch(result.acceptedClientIds);
    }

    if (entries.some((entry) => !processed.has(entry.client_id))) {
      scheduleNextWave(cancellationAtStart, queueBoundaryAtStart);
      return;
    }
  }

  const marker = `v1:${cancellationAtStart}:${queueBoundaryAtStart}`;
  try {
    await AsyncStorage.setItem(DRINKS_HISTORY_SEEDED_KEY, marker);
  } catch {
    return;
  }

  // Logout/reset may have started while the guard write was in flight. Do not
  // leave the old account's completion stamp attached to the replacement.
  if (
    cancellationAtStart !== cancellationGeneration ||
    queueBoundaryAtStart !== getDrinksQueueBoundaryGeneration()
  ) {
    try {
      if ((await AsyncStorage.getItem(DRINKS_HISTORY_SEEDED_KEY)) === marker) {
        await AsyncStorage.removeItem(DRINKS_HISTORY_SEEDED_KEY);
      }
    } catch {
      // clearLocalPrivateAccountData also removes the key.
    }
    return;
  }
  try {
    await AsyncStorage.removeItem(DRINKS_HISTORY_PROGRESS_KEY);
  } catch {
    // The completion guard wins; stale progress is ignored from now on.
  }
}

/**
 * Seed at most once concurrently. Call only after account initialization or a
 * foreground session resume has settled, so delivery cannot race token rotation.
 */
export function seedDrinksFromHistory(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = runHistorySeed().finally(() => {
    seedPromise = null;
  });
  return seedPromise;
}

/** Synchronously invalidate any captured history snapshot before account clear. */
export function cancelDrinksHistorySeed(): void {
  cancellationGeneration += 1;
  nextWaveNotBeforeMs = 0;
  if (scheduledWave) {
    clearTimeout(scheduledWave);
    scheduledWave = null;
  }
}
