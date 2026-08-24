import AsyncStorage, { privateAccountCleanupStorage } from '@/data/privateAccountStorage';

import type { NightRecord } from '@/party/nightRecord';

export const NIGHT_RECORD_STORAGE_KEY = 'na-pivo-party-night-records-v1';
export const NIGHT_RECORD_CACHE_LIMIT = 5;

interface CachedRecord {
  accountId: string;
  code: string | null;
  savedAt: number;
  record: NightRecord;
}

interface PersistedCache {
  version: 1;
  entries: CachedRecord[];
}

const recordCache = new Map<string, CachedRecord>();
let storageTail: Promise<void> = Promise.resolve();
let boundaryGeneration = 0;

function codeKey(accountId: string, code: string): string {
  return `${accountId}:code:${code.toUpperCase()}`;
}

function entryKey(entry: Pick<CachedRecord, 'accountId' | 'code' | 'record'>): string {
  return entry.code
    ? codeKey(entry.accountId, entry.code)
    : `${entry.accountId}:record:${entry.record.id}`;
}

function raw(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isPerson(value: unknown): boolean {
  const item = raw(value);
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    nullableString(item.avatarUrl) &&
    typeof item.tint === 'string' &&
    (item.joinedAt === undefined || typeof item.joinedAt === 'string') &&
    (item.leftAt === undefined || typeof item.leftAt === 'string') &&
    (item.active === undefined || typeof item.active === 'boolean')
  );
}

function isStop(value: unknown): boolean {
  const item = raw(value);
  return (
    !!item &&
    typeof item.id === 'string' &&
    (item.by === undefined || typeof item.by === 'string') &&
    typeof item.pubName === 'string' &&
    nullableString(item.cacheKey) &&
    typeof item.arrivedAt === 'string' &&
    (item.lat === undefined || typeof item.lat === 'number') &&
    (item.lng === undefined || typeof item.lng === 'number')
  );
}

function isDrink(value: unknown): boolean {
  const item = raw(value);
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.at === 'string' &&
    typeof item.by === 'string' &&
    typeof item.beerName === 'string' &&
    ['beer', 'soft_drink', 'shot', 'wine'].includes(String(item.drinkType)) &&
    (item.volumeMl === undefined || typeof item.volumeMl === 'number') &&
    nullableString(item.stopId)
  );
}

function isGameResult(value: unknown): boolean {
  const item = raw(value);
  return (
    !!item &&
    nullableString(item.winner) &&
    (item.paying === undefined || nullableString(item.paying)) &&
    Array.isArray(item.scores) &&
    item.scores.every((score) => {
      const row = raw(score);
      return !!row && typeof row.name === 'string' && typeof row.score === 'number';
    })
  );
}

function isGame(value: unknown): boolean {
  const item = raw(value);
  return (
    !!item &&
    typeof item.key === 'string' &&
    typeof item.name === 'string' &&
    typeof item.startedAt === 'string' &&
    (item.by === undefined || typeof item.by === 'string') &&
    (item.result === undefined || isGameResult(item.result))
  );
}

function isPhoto(value: unknown): boolean {
  const item = raw(value);
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.url === 'string' &&
    typeof item.at === 'string' &&
    typeof item.by === 'string'
  );
}

function isNightRecord(value: unknown): value is NightRecord {
  const item = raw(value);
  return (
    !!item &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    (item.code === null || (typeof item.code === 'string' && item.code.length > 0)) &&
    typeof item.startedAt === 'string' &&
    nullableString(item.endedAt) &&
    Array.isArray(item.people) &&
    item.people.every(isPerson) &&
    Array.isArray(item.stops) &&
    item.stops.every(isStop) &&
    Array.isArray(item.drinks) &&
    item.drinks.every(isDrink) &&
    Array.isArray(item.games) &&
    item.games.every(isGame) &&
    Array.isArray(item.photos) &&
    item.photos.every(isPhoto)
  );
}

function parseEntries(value: unknown): CachedRecord[] {
  const root = raw(value);
  if (root?.version !== 1 || !Array.isArray(root.entries)) return [];
  return root.entries
    .flatMap((value) => {
      const entry = raw(value);
      if (
        !entry ||
        typeof entry.accountId !== 'string' ||
        !entry.accountId ||
        (entry.code !== null && (typeof entry.code !== 'string' || !entry.code)) ||
        typeof entry.savedAt !== 'number' ||
        !Number.isFinite(entry.savedAt) ||
        !isNightRecord(entry.record) ||
        (entry.record.code?.toUpperCase() ?? null) !==
          (typeof entry.code === 'string' ? entry.code.toUpperCase() : null)
      ) {
        return [];
      }
      return [
        {
          accountId: entry.accountId,
          code: typeof entry.code === 'string' ? entry.code.toUpperCase() : null,
          savedAt: entry.savedAt,
          record: entry.record,
        },
      ];
    })
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, NIGHT_RECORD_CACHE_LIMIT);
}

async function readPersistedEntries(): Promise<CachedRecord[]> {
  try {
    const stored = await AsyncStorage.getItem(NIGHT_RECORD_STORAGE_KEY);
    return stored ? parseEntries(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

function queueStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageTail.catch(() => undefined).then(operation);
  storageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function setMemory(entry: CachedRecord): void {
  const cacheKey = entryKey(entry);
  recordCache.delete(cacheKey);
  recordCache.set(cacheKey, entry);
  while (recordCache.size > NIGHT_RECORD_CACHE_LIMIT) {
    const oldest = recordCache.keys().next().value as string | undefined;
    if (!oldest) break;
    recordCache.delete(oldest);
  }
}

export function readNightRecordCache(
  accountId: string | null | undefined,
  code: string | null | undefined,
): NightRecord | null {
  return accountId && code ? (recordCache.get(codeKey(accountId, code))?.record ?? null) : null;
}

/** Hydrate one known recap after a cold process restart. */
export function loadNightRecordCache(accountId: string, code: string): Promise<NightRecord | null> {
  const generation = boundaryGeneration;
  return queueStorage(async () => {
    const entries = await readPersistedEntries();
    if (generation !== boundaryGeneration) return null;
    for (const entry of [...entries].reverse()) setMemory(entry);
    return recordCache.get(codeKey(accountId, code))?.record ?? null;
  });
}

/** Latest completed recap for an account, used before the API comes back. */
export function loadLatestNightRecordCache(accountId: string): Promise<NightRecord | null> {
  const generation = boundaryGeneration;
  return queueStorage(async () => {
    const entries = await readPersistedEntries();
    if (generation !== boundaryGeneration) return null;
    for (const entry of [...entries].reverse()) setMemory(entry);
    return (
      [...recordCache.values()]
        .filter((entry) => entry.accountId === accountId && entry.record.endedAt !== null)
        .sort((left, right) => right.savedAt - left.savedAt)[0]?.record ?? null
    );
  });
}

/** Memory updates synchronously; the returned promise only tracks persistence. */
export function writeNightRecordCache(
  accountId: string | null | undefined,
  record: NightRecord,
): Promise<void> {
  if (!accountId || !record.id) return Promise.resolve();
  const newestMemoryStamp = Math.max(
    0,
    ...[...recordCache.values()].map((candidate) => candidate.savedAt),
  );
  const entry: CachedRecord = {
    accountId,
    code: record.code?.toUpperCase() ?? null,
    savedAt: Math.max(Date.now(), newestMemoryStamp + 1),
    record,
  };
  setMemory(entry);
  // The running table is restored from the canonical current-evening endpoint.
  // Persist only completed recaps; polling every ten seconds must not turn into
  // hundreds of AsyncStorage writes during one night.
  if (record.endedAt === null) return Promise.resolve();
  const generation = boundaryGeneration;
  return queueStorage(async () => {
    if (generation !== boundaryGeneration) return;
    const stored = await readPersistedEntries();
    if (generation !== boundaryGeneration) return;
    const entries = stored
      .filter((candidate) => entryKey(candidate) !== entryKey(entry))
      .concat(entry)
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(0, NIGHT_RECORD_CACHE_LIMIT);
    const payload: PersistedCache = { version: 1, entries };
    try {
      await AsyncStorage.setItem(NIGHT_RECORD_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // A recap cache is best-effort; the private server record remains canonical.
    }
  });
}

/** Account boundaries drop both in-process and durable private table data. */
export function clearNightRecordCache(): Promise<void> {
  boundaryGeneration += 1;
  recordCache.clear();
  return queueStorage(async () => {
    try {
      await privateAccountCleanupStorage.removeItem(NIGHT_RECORD_STORAGE_KEY);
    } catch {
      // The account-boundary caller also removes the key in its bulk clear.
    }
  });
}
