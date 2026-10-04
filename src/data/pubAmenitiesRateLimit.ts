/**
 * Shared 429 pause for PUT /v1/pub-amenities/votes.
 *
 * The backend counts every vote PUT of one account in a fixed window and answers
 * 429 with Retry-After until that window ends. The queue and the map sheet's live
 * vote both check this pause before sending, so one 429 stops every vote request
 * instead of the queue firing its remaining items into the same closed window.
 * Consecutive 429s with no other answer in between lengthen the pause. The
 * deadline is persisted so a restart cannot skip it, and account.ts clears it
 * when the account changes. No other app imports here, so account.ts can call in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'na-pivo-pub-amenities-retry-after';
/** Minimum pause per consecutive 429; a longer Retry-After always wins. */
const BACKOFF_MS = [5_000, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const MAX_DELAY_MS = 24 * 60 * 60_000;

let retryAt = 0;
let attempt = 0;
let generation = 0;
let restorePromise: Promise<void> | null = null;
let storageWrite: Promise<void> = Promise.resolve();

/** Retry-After in delta-seconds or HTTP-date form; null when missing or past. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  const duration = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function restore(): Promise<void> {
  if (!restorePromise) {
    const expectedGeneration = generation;
    restorePromise = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const saved = Number(raw);
        const now = Date.now();
        if (expectedGeneration === generation && saved > now && saved <= now + MAX_DELAY_MS) {
          retryAt = Math.max(retryAt, saved);
        }
      })
      .catch(() => undefined);
  }
  return restorePromise;
}

/** Epoch ms before which no vote PUT may be sent, or 0 when sending is allowed. */
export async function getAmenityVotesRetryAt(): Promise<number> {
  await restore();
  return retryAt > Date.now() ? retryAt : 0;
}

/** Synchronous check right before fetch, after getAmenityVotesRetryAt loaded the saved deadline. */
export function isAmenityVotesPaused(): boolean {
  return retryAt > Date.now();
}

/** Capture before sending, so an answer that lands after an account switch is ignored. */
export function getAmenityVotesRateLimitGeneration(): number {
  return generation;
}

/** Record the HTTP answer to a sent vote PUT. */
export async function noteAmenityVotesResponse(
  response: Response,
  sentGeneration: number,
): Promise<void> {
  if (sentGeneration !== generation) return;
  if (response.status !== 429) {
    attempt = 0;
    return;
  }
  const now = Date.now();
  // Requests rejected while a pause is already running belong to the same 429.
  if (retryAt <= now) attempt = Math.min(attempt + 1, BACKOFF_MS.length);
  const backoff = BACKOFF_MS[Math.max(attempt, 1) - 1];
  const delay = Math.min(Math.max(retryAfterMs(response) ?? 0, backoff), MAX_DELAY_MS);
  retryAt = Math.max(retryAt, now + delay);
  const deadline = retryAt;
  storageWrite = storageWrite
    .then(() => {
      if (sentGeneration === generation) return AsyncStorage.setItem(STORAGE_KEY, String(deadline));
    })
    .catch(() => undefined);
  // The in-memory pause already holds if the write fails.
  await storageWrite;
}

/** A different account has its own server budget, so it starts without a pause. */
export function clearAmenityVotesRateLimit(): Promise<void> {
  generation += 1;
  retryAt = 0;
  attempt = 0;
  restorePromise = Promise.resolve();
  storageWrite = storageWrite.then(() => AsyncStorage.removeItem(STORAGE_KEY)).catch(() => undefined);
  return storageWrite;
}
