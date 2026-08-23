import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  fetchFriendsDashboard,
  fetchNextFriendsDashboardPage,
  mergeFriendsDashboardPage,
  fetchFriendsLive,
  markFriendNotificationsRead,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { ensureFriendPushRegisteredIfGranted } from '@/notifications/friendPush';
import { useAccountStore } from '@/stores/accountStore';
import { hasLiveFriendSignal, usePartaSignalStore } from '@/stores/partaSignalStore';

const LIVE_POLL_MS = 35_000;

export interface PartaDashboardController {
  dashboard: FriendsDashboard | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  reload: () => void;
  refresh: () => void;
  loadMore: () => void;
}

/** Shared, race-safe controller for every Parta surface. */
export function usePartaDashboard({ markRead = false }: { markRead?: boolean } = {}): PartaDashboardController {
  // Active account boundary: Parta screens stay mounted across an account
  // switch, so every piece of state and async work below is owned by whoever
  // this id pointed at when the work started.
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const [dashboard, setDashboard] = useState<FriendsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focused, setFocused] = useState(false);
  const mountedRef = useRef(true);
  const ownerAccountRef = useRef<string | null>(accountId);
  /** Bumped only at account boundaries — unlike generationRef, which every load moves. */
  const boundaryEpochRef = useRef(0);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollGenerationRef = useRef(0);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const pagePromiseRef = useRef<Promise<void> | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      pollAbortRef.current?.abort();
      pageAbortRef.current?.abort();
    },
    [],
  );

  // Snapshot hydration is account-bound: the read captures the accountId and
  // boundary epoch it started under, and a result that outlives either one
  // never touches state — so a blob persisted by the previous account cannot
  // leak into the next one.
  useEffect(() => {
    let alive = true;
    const ownerAccount = accountId;
    const epoch = boundaryEpochRef.current;
    void loadFriendsDashboardSnapshot().then((snapshot) => {
      if (
        !alive ||
        !snapshot ||
        ownerAccount !== ownerAccountRef.current ||
        epoch !== boundaryEpochRef.current
      ) {
        return;
      }
      setDashboard((current) => current ?? snapshot.dashboard);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      const ownerAccount = ownerAccountRef.current;
      const generation = ++generationRef.current;
      pageAbortRef.current?.abort();
      pageAbortRef.current = null;
      pagePromiseRef.current = null;
      setLoadingMore(false);
      pollAbortRef.current?.abort();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (mode === 'refresh') setRefreshing(true);
      const isCurrent = () =>
        mountedRef.current &&
        ownerAccount === ownerAccountRef.current &&
        generation === generationRef.current;

      try {
        const next = await fetchFriendsDashboard(controller.signal);
        if (!isCurrent()) return;
        if (!next) {
          setStale(true);
          return;
        }
        setDashboard(next);
        setStale(false);
        const shouldMarkRead = markRead && next.notifications.length > 0;
        if (shouldMarkRead) {
          void markFriendNotificationsRead(next.notifications.map((item) => item.id));
        }
        usePartaSignalStore.getState().setSignal({
          pendingRequests: next.incomingRequests.length,
          unread: shouldMarkRead ? 0 : next.unreadCount,
          liveNow: hasLiveFriendSignal(next),
        });
      } catch {
        if (!controller.signal.aborted && isCurrent()) setStale(true);
      } finally {
        if (isCurrent()) {
          if (mode === 'initial') setLoading(false);
          if (mode === 'refresh') setRefreshing(false);
        }
      }
    },
    [markRead],
  );

  /**
   * Account boundary (P0 privacy): when the active accountId rotates while the
   * screens stay mounted, wipe every trace the previous account owned
   * synchronously (before paint) — dashboard state, loading flags, in-flight
   * controllers and generations — zero the badge signal it left behind, then
   * reload through the normal focused flow. A token refresh for the same
   * accountId is not a boundary.
   */
  useLayoutEffect(() => {
    if (ownerAccountRef.current === accountId) return;
    ownerAccountRef.current = accountId;
    boundaryEpochRef.current += 1;
    generationRef.current += 1;
    pollGenerationRef.current += 1;
    abortRef.current?.abort();
    pollAbortRef.current?.abort();
    pageAbortRef.current?.abort();
    abortRef.current = null;
    pollAbortRef.current = null;
    pageAbortRef.current = null;
    pagePromiseRef.current = null;
    setDashboard(null);
    setLoading(true);
    setRefreshing(false);
    setStale(false);
    setLoadingMore(false);
    usePartaSignalStore.getState().setSignal({ pendingRequests: 0, unread: 0, liveNow: false });
    void load('initial');
  }, [accountId, load]);

  const pollLive = useCallback(async () => {
    const ownerAccount = ownerAccountRef.current;
    const generation = ++pollGenerationRef.current;
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    const live = await fetchFriendsLive(controller.signal);
    if (!mountedRef.current || ownerAccount !== ownerAccountRef.current || generation !== pollGenerationRef.current) {
      return;
    }
    if (!live) {
      setStale(true);
      return;
    }
    setDashboard((current) =>
      current
        ? {
            ...current,
            activeFriends: live.activeFriends,
            myActiveActivity: live.myActiveActivity,
            plans: live.plans,
            myPlan: live.myPlan,
            presence: live.presence,
            myPresence: live.myPresence,
          }
        : current,
    );
    setStale(false);
    usePartaSignalStore.getState().setSignal({
      pendingRequests: live.incomingCount,
      unread: live.unreadCount,
      liveNow: hasLiveFriendSignal(live),
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const forced = usePartaSignalStore.getState().consumeRefresh() != null;
      void load(forced ? 'refresh' : 'initial');
      void ensureFriendPushRegisteredIfGranted();
      return () => setFocused(false);
    }, [load]),
  );

  useEffect(() => {
    if (!focused) return undefined;
    return usePartaSignalStore.subscribe((state, previous) => {
      if (state.pendingRefresh && !previous.pendingRefresh) {
        usePartaSignalStore.getState().consumeRefresh();
        void load('silent');
      }
    });
  }, [focused, load]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused) void load('silent');
    });
    return () => subscription.remove();
  }, [focused, load]);

  const hasLiveData = useMemo(
    () =>
      dashboard != null &&
      (dashboard.presence.length > 0 ||
        dashboard.activeFriends.length > 0 ||
        dashboard.myActiveActivity != null ||
        dashboard.myPlan != null ||
        dashboard.plans.length > 0),
    [dashboard],
  );

  useEffect(() => {
    if (!focused || !hasLiveData) return undefined;
    const timer = setInterval(() => void pollLive(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [focused, hasLiveData, pollLive]);

  const hasMore = useMemo(
    () =>
      (dashboard?.relationshipPage?.friendsTruncated ?? false) ||
      (dashboard?.relationshipPage?.followingTruncated ?? false),
    [dashboard?.relationshipPage],
  );

  const loadMore = useCallback(() => {
    if (!dashboard || !hasMore || pagePromiseRef.current) return;
    const ownerAccount = ownerAccountRef.current;
    const capturedDashboard = dashboard;
    const generation = generationRef.current;
    const controller = new AbortController();
    pageAbortRef.current = controller;
    setLoadingMore(true);

    const task: Promise<void> = fetchNextFriendsDashboardPage(capturedDashboard, controller.signal)
      .then((next) => {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          ownerAccount !== ownerAccountRef.current ||
          generation !== generationRef.current
        ) {
          return;
        }
        if (!next) {
          setStale(true);
          return;
        }
        setDashboard((currentLatest) => (currentLatest ? mergeFriendsDashboardPage(currentLatest, next) : next));
        setStale(false);
      })
      .catch(() => {
        if (
          mountedRef.current &&
          !controller.signal.aborted &&
          ownerAccount === ownerAccountRef.current &&
          generation === generationRef.current
        ) {
          setStale(true);
        }
      })
      .finally(() => {
        if (pagePromiseRef.current === task) {
          pagePromiseRef.current = null;
          if (mountedRef.current) {
            pageAbortRef.current = null;
            setLoadingMore(false);
          }
        }
      });

    pagePromiseRef.current = task;
  }, [dashboard, hasMore]);

  return {
    dashboard,
    loading,
    loadingMore,
    refreshing,
    stale,
    hasMore,
    loadMore,
    reload: () => void load('silent'),
    refresh: () => void load('refresh'),
  };
}
