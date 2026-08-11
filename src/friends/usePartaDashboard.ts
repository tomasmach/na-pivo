import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  fetchFriendsDashboard,
  fetchFriendsLive,
  markFriendNotificationsRead,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { ensureFriendPushRegisteredIfGranted } from '@/notifications/friendPush';
import { usePartaSignalStore } from '@/stores/partaSignalStore';

const LIVE_POLL_MS = 35_000;

export interface PartaDashboardController {
  dashboard: FriendsDashboard | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  reload: () => void;
  refresh: () => void;
}

/** Shared, race-safe controller for every Parta surface. */
export function usePartaDashboard({ markRead = false }: { markRead?: boolean } = {}): PartaDashboardController {
  const [dashboard, setDashboard] = useState<FriendsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [focused, setFocused] = useState(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollGenerationRef = useRef(0);
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      pollAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    void loadFriendsDashboardSnapshot().then((snapshot) => {
      if (!alive || !snapshot) return;
      setDashboard((current) => current ?? snapshot.dashboard);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'silent') => {
      const generation = ++generationRef.current;
      pollAbortRef.current?.abort();
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (mode === 'refresh') setRefreshing(true);

      try {
        const next = await fetchFriendsDashboard(controller.signal);
        if (!mountedRef.current || generation !== generationRef.current) return;
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
          liveNow:
            next.presence.length > 0 ||
            next.activeFriends.length > 0 ||
            next.myActiveActivity != null,
        });
      } catch {
        if (!controller.signal.aborted && generation === generationRef.current) setStale(true);
      } finally {
        if (mountedRef.current && generation === generationRef.current) {
          if (mode === 'initial') setLoading(false);
          if (mode === 'refresh') setRefreshing(false);
        }
      }
    },
    [markRead],
  );

  const pollLive = useCallback(async () => {
    const generation = ++pollGenerationRef.current;
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    const live = await fetchFriendsLive(controller.signal);
    if (!mountedRef.current || generation !== pollGenerationRef.current) return;
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
      liveNow:
        live.presence.length > 0 ||
        live.activeFriends.length > 0 ||
        live.myActiveActivity != null,
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

  return {
    dashboard,
    loading,
    refreshing,
    stale,
    reload: () => void load('silent'),
    refresh: () => void load('refresh'),
  };
}
