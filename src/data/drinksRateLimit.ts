/** One persisted cooldown for the backend's shared drinks throttle scope. */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'na-pivo-drinks-retry-after';
const FALLBACK_DELAY_MS = 60_000;
const MAX_DELAY_MS = 24 * 60 * 60_000;

let restored = false;
let restorePromise: Promise<void> | null = null;
let retryAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const flushes = new Set<() => Promise<void>>();

async function restore(): Promise<void> {
  if (restored) return;
  if (!restorePromise) {
    restorePromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const saved = Number(raw);
        const now = Date.now();
        if (raw && Number.isFinite(saved) && saved > now && saved <= now + MAX_DELAY_MS) {
          retryAt = Math.max(retryAt, saved);
        }
      })
      .catch(() => undefined)
      .then(() => { restored = true; });
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
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // These operations share one server throttle. Run them in sequence so a
    // new 429 can pause the remaining queues before they make another request.
    void (async () => {
      for (const flush of flushes) {
        if (await shouldPauseDrinkSync()) break;
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

/** True while a 429 from any drink request bars the shared drinks endpoint. */
export async function shouldPauseDrinkSync(): Promise<boolean> {
  await restore();
  if (retryAt <= Date.now()) return false;
  schedule();
  return true;
}

export async function noteDrinkThrottled(response: Response): Promise<void> {
  await restore();
  retryAt = Math.max(retryAt, Date.now() + retryDelay(response));
  try {
    await AsyncStorage.setItem(STORAGE_KEY, String(retryAt));
  } catch {
    // Keep the in-memory deadline; queued operations remain durable themselves.
  }
  schedule();
}
