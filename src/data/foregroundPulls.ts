/**
 * Throttle for the server PULLS the app runs when it returns to the foreground.
 *
 * People reopen the app for every beer, so each foreground used to re-download
 * ratings, amenity votes, the diary snapshot, their added pubs, re-register
 * push and re-seed geofences. Offline queue FLUSHES are not throttled here;
 * they still run on every launch and foreground. Keys include the account id,
 * so a sign-in, claim or account switch pulls again immediately.
 */

export type ForegroundPull = 'ratings' | 'amenities' | 'diary' | 'addedPubs' | 'push' | 'geofences';

export const ALL_FOREGROUND_PULLS: readonly ForegroundPull[] = [
  'ratings',
  'amenities',
  'diary',
  'addedPubs',
  'push',
  'geofences',
];

export const FOREGROUND_PULL_MIN_INTERVAL_MS = 5 * 60 * 1000;

const lastPullAt = new Map<string, number>();

function pullKey(pull: ForegroundPull, accountId: string): string {
  return `${accountId}:${pull}`;
}

/** Record pulls that just ran outside the foreground handler (cold start). */
export function markForegroundPulls(
  accountId: string | null | undefined,
  pulls: readonly ForegroundPull[],
  nowMs = Date.now(),
): void {
  if (!accountId) return;
  for (const pull of pulls) lastPullAt.set(pullKey(pull, accountId), nowMs);
}

/**
 * True when `pull` may run now for `accountId`, and records it as run. Without
 * a known account there is nothing to dedupe against, so it always runs.
 */
export function claimForegroundPull(
  pull: ForegroundPull,
  accountId: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!accountId) return true;
  const key = pullKey(pull, accountId);
  const last = lastPullAt.get(key);
  // A clock moved backwards must not block pulls until it catches up.
  if (last !== undefined && nowMs >= last && nowMs - last < FOREGROUND_PULL_MIN_INTERVAL_MS) {
    return false;
  }
  lastPullAt.set(key, nowMs);
  return true;
}

export function resetForegroundPullsForTests(): void {
  lastPullAt.clear();
}
