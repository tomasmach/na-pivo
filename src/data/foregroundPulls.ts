/**
 * Throttle for the server PULLS the app runs when it returns to the foreground.
 *
 * People reopen the app for every beer, so each foreground used to re-download
 * ratings, amenity votes, the diary snapshot and their added pubs. A pull that
 * reached the server within the last few minutes is skipped. Only a successful
 * pull counts, so an offline launch or a failed request retries on the next
 * foreground. Offline queue FLUSHES are not throttled here; they still run on
 * every launch and foreground. Keys include the account id, so a sign-in, claim
 * or account switch pulls again immediately.
 */

export type ForegroundPull = 'ratings' | 'amenities' | 'diary' | 'addedPubs';

export const FOREGROUND_PULL_MIN_INTERVAL_MS = 5 * 60 * 1000;

const lastPullAt = new Map<string, number>();

function pullKey(pull: ForegroundPull, accountId: string): string {
  return `${accountId}:${pull}`;
}

/** True when `pull` reached the server for `accountId` within the interval. */
export function pulledRecently(
  pull: ForegroundPull,
  accountId: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!accountId) return false;
  const last = lastPullAt.get(pullKey(pull, accountId));
  // A clock moved backwards must not block pulls until it catches up.
  return last !== undefined && nowMs >= last && nowMs - last < FOREGROUND_PULL_MIN_INTERVAL_MS;
}

/**
 * Run a pull and record it only when it reached the server. The account is
 * read when the pull starts; a launch pull may start before the session is
 * hydrated, so an unknown start account adopts the one present at the end.
 */
export function trackForegroundPull(
  pull: ForegroundPull,
  run: () => Promise<boolean>,
  currentAccountId: () => string | null,
  nowMs: () => number = Date.now,
): Promise<boolean> {
  const startAccountId = currentAccountId();
  return run().then(
    (ok) => {
      const endAccountId = currentAccountId();
      if (ok && endAccountId && (startAccountId === null || startAccountId === endAccountId)) {
        lastPullAt.set(pullKey(pull, endAccountId), nowMs());
      }
      return ok;
    },
    () => false,
  );
}

export function resetForegroundPullsForTests(): void {
  lastPullAt.clear();
}
