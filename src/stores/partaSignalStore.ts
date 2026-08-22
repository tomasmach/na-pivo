/**
 * Lightweight, in-memory Parta signal bus (Parta 3.0 §D1).
 *
 * Two consumers read this store WITHOUT touching the heavier friends dashboard:
 *   - TabBar renders the amber badge/dot from `pendingRequests` / `unread` /
 *     `liveNow` (a numeric pill for pending requests, else an ambient dot).
 *   - FriendsScreen consumes `pendingRefresh` (+ optional `focusTarget`) to force
 *     a reload when a push tap or invite claim needs fresh data.
 *
 * Not persisted — it mirrors live server state and is repopulated on every
 * dashboard/live fetch and on foreground push receipts.
 */

import { create } from 'zustand';

interface FriendLiveSignalSlice {
  presence: readonly unknown[];
  activeFriends: readonly unknown[];
}

export function hasLiveFriendSignal(slice: FriendLiveSignalSlice): boolean {
  return slice.presence.length > 0 || slice.activeFriends.length > 0;
}

/** Optional row to scroll to / highlight after a push-driven refresh. */
export interface PartaFocusTarget {
  activityId: string | null;
  friendshipId: string | null;
}

interface PartaSignalState {
  /** Incoming friend requests waiting for me (drives the numeric badge). */
  pendingRequests: number;
  /** Unread feed items (drives the ambient dot). */
  unread: number;
  /** A friend is live-now (drives the breathing dot). */
  liveNow: boolean;
  /** True when FriendsScreen should force a refresh on its next focus. */
  pendingRefresh: boolean;
  /** Where to scroll after that refresh, when a push payload named a target. */
  focusTarget: PartaFocusTarget | null;
  /** Update the ambient badge signal from a dashboard / live fetch. */
  setSignal: (signal: { pendingRequests: number; unread: number; liveNow: boolean }) => void;
  /**
   * Nudge the badge from a foreground push receipt, before any fetch runs, so it
   * lights up even on a tab that hasn't mounted FriendsScreen yet (§D1). The next
   * dashboard/live fetch overwrites these with authoritative server counts.
   */
  bumpFromPush: (kind: string) => void;
  /** Ask FriendsScreen to refresh (push tap / claim), optionally at a target. */
  requestRefresh: (target?: Partial<PartaFocusTarget>) => void;
  /** Consume the pending-refresh flag, returning any focus target and clearing it. */
  consumeRefresh: () => PartaFocusTarget | null;
}

export const usePartaSignalStore = create<PartaSignalState>((set, get) => ({
  pendingRequests: 0,
  unread: 0,
  liveNow: false,
  pendingRefresh: false,
  focusTarget: null,

  setSignal: ({ pendingRequests, unread, liveNow }) =>
    set({ pendingRequests, unread, liveNow }),

  bumpFromPush: (kind) =>
    set((s) => {
      if (kind === 'friend_request') return { pendingRequests: s.pendingRequests + 1 };
      // A friend going live now also lights the "live" dot; every other friend
      // push (cheers, accepted, rsvp, plan) just bumps the ambient unread dot.
      if (kind === 'friend_at_pub') return { liveNow: true, unread: s.unread + 1 };
      return { unread: s.unread + 1 };
    }),

  requestRefresh: (target) =>
    set({
      pendingRefresh: true,
      focusTarget:
        target && (target.activityId || target.friendshipId)
          ? { activityId: target.activityId ?? null, friendshipId: target.friendshipId ?? null }
          : null,
    }),

  consumeRefresh: () => {
    const { pendingRefresh, focusTarget } = get();
    if (!pendingRefresh) return null;
    set({ pendingRefresh: false, focusTarget: null });
    return focusTarget;
  },
}));
