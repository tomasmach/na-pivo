/** One persisted cooldown for the backend's shared drinks throttle scope. */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'na-pivo-drinks-retry-after';
const FALLBACK_DELAY_MS = 60_000;
const MAX_DELAY_MS = 24 * 60 * 60_000;

let restored = false;
let restorePromise: Promise<void> | null = null;
let retryAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let storageWrite: Promise<void> = Promise.resolve();
let ownerAccountId: string | null = null;
let readAccountId: (() => Promise<string | null | undefined>) | null = null;
const flushes = new Set<() => Promise<void>>();

/** Reads the secure cache only; undefined means it is temporarily unavailable. */
export function registerDrinkRateLimitAccountReader(reader: () => Promise<string | null | undefined>): void {
  readAccountId = reader;
}

async function currentAccountId(): Promise<string | null | undefined> {
  try {
    return await readAccountId?.();
  } catch {
    return undefined;
  }
}

async function restore(accountId: string): Promise<void> {
  if (restored) return;
  if (!restorePromise) {
    const expectedGeneration = generation;
    restorePromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (expectedGeneration !== generation || ownerAccountId !== accountId || !raw) return;
        let saved: unknown;
        try { saved = JSON.parse(raw); } catch { return; }
        if (!saved || typeof saved !== 'object') return;
        const { accountId: savedAccountId, retryAt: savedRetryAt } = saved as Record<string, unknown>;
        const now = Date.now();
        if (savedAccountId === accountId && typeof savedRetryAt === 'number' &&
          Number.isFinite(savedRetryAt) && savedRetryAt > now && savedRetryAt <= now + MAX_DELAY_MS) {
          retryAt = Math.max(retryAt, savedRetryAt);
        }
      })
      .catch(() => undefined)
      .then(() => { if (expectedGeneration === generation && ownerAccountId === accountId) restored = true; });
  }
  await restorePromise;
}

async function syncOwner(): Promise<string | null> {
  const expectedGeneration = generation;
  const accountId = await currentAccountId();
  if (expectedGeneration !== generation) return null;
  if (accountId === undefined) return ownerAccountId;
  if (!accountId) return null;
  if (ownerAccountId !== accountId) {
    if (ownerAccountId !== null) generation += 1;
    ownerAccountId = accountId;
    retryAt = 0;
    restored = false;
    restorePromise = null;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }
  await restore(accountId);
  return accountId;
}

function schedule(): void {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = retryAt - Date.now();
  if (delay <= 0 || flushes.size === 0) {
    retryTimer = null;
    return;
  }
  const scheduledGeneration = generation;
  const scheduledOwner = ownerAccountId;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (scheduledGeneration !== generation) return;
    // These operations share one server throttle. Run them in sequence so a
    // new 429 can pause the remaining queues before they make another request.
    void (async () => {
      if (await currentAccountId() !== scheduledOwner) return;
      for (const flush of flushes) {
        if (scheduledGeneration !== generation) break;
        if (await shouldPauseDrinkSync()) break;
        if (scheduledGeneration !== generation) break;
        await flush();
      }
    })();
  }, delay);
}

function retryDelay(response: Response): number {
  const header = response.headers?.get('Retry-After');
  if (header) {
    const seconds = Number(header);
    const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
    if (Number.isFinite(duration) && duration > 0) {
      return Math.min(duration, MAX_DELAY_MS);
    }
  }
  return FALLBACK_DELAY_MS;
}

export function registerDrinkRetryFlush(flush: () => Promise<void>): void {
  flushes.add(flush);
}

/** Capture the account boundary before a request leaves with its bearer. */
export function getDrinkRateLimitGeneration(): number {
  return generation;
}

/** True while a 429 from any drink request bars the shared drinks endpoint. */
export async function shouldPauseDrinkSync(): Promise<boolean> {
  if (!await syncOwner()) return false;
  if (retryAt <= Date.now()) return false;
  schedule();
  return true;
}

export async function noteDrinkThrottled(
  response: Response,
  expectedGeneration = generation,
  requestAccountId?: string,
): Promise<void> {
  if (expectedGeneration !== generation) return;
  const accountId = await syncOwner();
  if (!accountId || (requestAccountId && requestAccountId !== accountId) || expectedGeneration !== generation) return;
  retryAt = Math.max(retryAt, Date.now() + retryDelay(response));
  const deadline = retryAt;
  const write = storageWrite.then(async () => {
    if (expectedGeneration === generation && ownerAccountId === accountId) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ accountId, retryAt: deadline }));
    }
  });
  storageWrite = write.catch(() => undefined);
  try {
    await write;
  } catch {
    // Keep the in-memory deadline; queued operations remain durable themselves.
  }
  if (expectedGeneration === generation) schedule();
}

/** A new account must not inherit the previous account's retry deadline. */
export async function clearDrinkRateLimit(nextAccountId?: string | null): Promise<void> {
  generation += 1;
  if (nextAccountId !== undefined) ownerAccountId = nextAccountId;
  retryAt = 0;
  restored = true;
  restorePromise = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const remove = storageWrite.then(() => AsyncStorage.removeItem(STORAGE_KEY));
  storageWrite = remove.catch(() => undefined);
  // Storage cleanup is best effort; a failed removal must not abort an account change.
  await storageWrite;
}
