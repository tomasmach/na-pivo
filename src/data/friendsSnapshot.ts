/**
 * Persisted snapshot of the last successful Parta dashboard (Parta 3.0 §H2).
 *
 * The social graph (friends, streak, leaderboard, live cards) is expensive to
 * refetch and useless when offline. On every successful `fetchFriendsDashboard`
 * we stash the already-parsed dashboard here; on mount FriendsScreen hydrates
 * from it BEFORE the network resolves, so an offline cold start shows the graph
 * behind the OfflineBanner instead of an empty tab.
 *
 * The blob is the user's social graph → sensitive. The storage key is registered
 * in `PRIVATE_STORAGE_KEYS` (privateAccountData.ts) so logout / account-switch
 * wipes it alongside the queues. Best-effort throughout: a failed read/write just
 * means the app falls back to a network fetch.
 */

import AsyncStorage, { privateAccountCleanupStorage } from './privateAccountStorage';

import type { FriendsDashboard } from './friendsClient';

export const FRIENDS_DASHBOARD_SNAPSHOT_KEY = 'na-pivo-friends-dashboard';

interface StoredSnapshot {
  savedAt: number;
  dashboard: FriendsDashboard;
}

export interface FriendsDashboardSnapshot {
  /** Epoch ms when the snapshot was written — lets the UI show a "stale" cue. */
  savedAt: number;
  dashboard: FriendsDashboard;
}

/**
 * Account-boundary generation. `clearFriendsDashboardSnapshot()` bumps it (called
 * from clearLocalPrivateAccountData on logout / delete / password reset). A
 * dashboard fetch captures the generation via {@link snapshotGeneration} BEFORE it
 * begins; its fire-and-forget write is dropped if the generation moved in the
 * meantime, so an in-flight fetch that resolves after the session rotates cannot
 * re-persist the previous account's social graph under the next account. This
 * mirrors the queue `abortInFlight` guard (see createQueue.ts).
 */
let boundaryGeneration = 0;

/** The current account-boundary generation, captured before a dashboard fetch. */
export function snapshotGeneration(): number {
  return boundaryGeneration;
}

/**
 * Persist the latest dashboard. Never throws. `generation` is the value
 * {@link snapshotGeneration} returned before the fetch started; the write is
 * suppressed (and any blob that raced in is removed) once an account-boundary
 * clear has bumped the generation.
 */
export async function saveFriendsDashboardSnapshot(
  dashboard: FriendsDashboard,
  generation: number,
): Promise<void> {
  if (generation !== boundaryGeneration) return;
  try {
    const payload: StoredSnapshot = { savedAt: Date.now(), dashboard };
    await AsyncStorage.setItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY, JSON.stringify(payload));
    // A boundary clear that landed while we were writing would otherwise leave our
    // just-written blob behind — undo it if the generation moved mid-write.
    if (generation !== boundaryGeneration) {
      await AsyncStorage.removeItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY);
    }
  } catch {
    // Snapshot is a convenience cache; a write failure just means no offline seed.
  }
}

/** Load the last persisted dashboard, or null when absent / unreadable. */
export async function loadFriendsDashboardSnapshot(): Promise<FriendsDashboardSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSnapshot>;
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.dashboard ||
      !Array.isArray((parsed.dashboard as FriendsDashboard).friends)
    ) {
      return null;
    }
    const dashboard = parsed.dashboard as FriendsDashboard;
    return {
      savedAt: parsed.savedAt,
      dashboard: {
        // A snapshot written by an older build has no presence keys at all, and
        // the screen reads them unconditionally. Backfill rather than reject —
        // a cold start offline should still show the last-known graph.
        ...dashboard,
        presence: Array.isArray(dashboard.presence) ? dashboard.presence : [],
        myPresence: dashboard.myPresence ?? null,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Drop the persisted snapshot at an account boundary. Bumps the generation FIRST
 * so any in-flight dashboard fetch's pending write is suppressed rather than
 * re-creating the file after the session rotates. Never throws.
 */
export async function clearFriendsDashboardSnapshot(): Promise<void> {
  boundaryGeneration += 1;
  try {
    await privateAccountCleanupStorage.removeItem(FRIENDS_DASHBOARD_SNAPSHOT_KEY);
  } catch {
    // Nothing to do — the write guard above already blocks a stale re-persist.
  }
}
