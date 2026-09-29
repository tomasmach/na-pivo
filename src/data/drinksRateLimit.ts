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
const flushes = new Set<() => Promise<void>>();

async function restore(): Promise<void> {
  if (restored) return;
  if (!restorePromise) {
    const expectedGeneration = generation;
    restorePromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (expectedGeneration !== generation) return;
        const saved = Number(raw);
        const now = Date.now();
        if (raw && Number.isFinite(saved) && saved > now && saved <= now + MAX_DELAY_MS) {
          retryAt = Math.max(retryAt, saved);
        }
      })
      .catch(() => undefined)
      .then(() => { if (expectedGeneration === generation) restored = true; });
  }
  await restorePromise;
}

function schedule(): void {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = retryAt - Date.now();
  if (delay <= 0 || flushes.size === 0) {
    retryTimer = null;
    return;
  }
  const scheduledGeneration = generation;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (scheduledGeneration !== generation) return;
    // These operations share one server throttle. Run them in sequence so a
    // new 429 can pause the remaining queues before they make another request.
    void (async () => {
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
  await restore();
  if (retryAt <= Date.now()) return false;
  schedule();
  return true;
}

export async function noteDrinkThrottled(response: Response, expectedGeneration = generation): Promise<void> {
  if (expectedGeneration !== generation) return;
  await restore();
  if (expectedGeneration !== generation) return;
  retryAt = Math.max(retryAt, Date.now() + retryDelay(response));
  const deadline = retryAt;
  const write = storageWrite.then(async () => {
    if (expectedGeneration === generation) await AsyncStorage.setItem(STORAGE_KEY, String(deadline));
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
export async function clearDrinkRateLimit(): Promise<void> {
  generation += 1;
  retryAt = 0;
  restored = true;
  restorePromise = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const remove = storageWrite.then(() => AsyncStorage.removeItem(STORAGE_KEY));
  storageWrite = remove.catch(() => undefined);
  await remove;
}
