import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  fetchFriendsDashboard,
  markFriendNotificationsRead,
  type ActivityResponseKind,
  type FriendsDashboard,
} from '@/data/friendsClient';
import { loadFriendsDashboardSnapshot, snapshotGeneration } from '@/data/friendsSnapshot';
import { fetchPartaPlans, type PartaPlan } from '@/data/partaPlansClient';
import type { CommunityEventsDashboard } from '@/data/communityEventsClient';
import { usePartaSignalStore } from '@/stores/partaSignalStore';

type PartaState = {
  dashboard: FriendsDashboard | null;
  plans: PartaPlan[] | null;
  loading: boolean;
  /** The last refresh failed; whatever is shown is the saved copy. */
  failed: boolean;
  generation: number;
  meetups: CommunityEventsDashboard | null;
  load: () => Promise<void>;
  setDashboard: (fn: (d: FriendsDashboard) => FriendsDashboard) => void;
  upsertPlan: (plan: PartaPlan) => void;
  removePlan: (id: string) => void;
  setMyResponse: (id: string, response: ActivityResponseKind | null) => void;
  setMeetups: (meetups: CommunityEventsDashboard | null) => void;
};

let inFlight: Promise<void> | null = null;

export const usePartaStore = create<PartaState>((set, get) => ({
  dashboard: null,
  plans: null,
  loading: false,
  failed: false,
  generation: snapshotGeneration(),
  meetups: null,

  load: () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const generation = snapshotGeneration();
      // An account switch must not show the previous account's crew.
      if (generation !== get().generation) set({ dashboard: null, plans: null, meetups: null, generation });
      if (!get().dashboard) {
        const saved = await loadFriendsDashboardSnapshot();
        if (saved && generation === snapshotGeneration() && !get().dashboard) set({ dashboard: saved.dashboard });
      }
      set({ loading: true });
      const [dashboard, plans] = await Promise.all([fetchFriendsDashboard(), fetchPartaPlans()]);
      if (generation !== snapshotGeneration()) return;
      set({
        dashboard: dashboard ?? get().dashboard,
        plans: plans ?? get().plans,
        failed: !dashboard || !plans,
        loading: false,
      });
      if (dashboard) {
        // Opening Parta is what clears the tab dot, as in the old screen.
        if (dashboard.notifications.length) void markFriendNotificationsRead(dashboard.notifications.map((n) => n.id));
        usePartaSignalStore.getState().setSignal({
          pendingRequests: dashboard.incomingRequests.length,
          unread: 0,
          liveNow: dashboard.presence.length > 0 || dashboard.activeFriends.length > 0 || dashboard.myActiveActivity != null,
        });
      }
    })().finally(() => {
      inFlight = null;
      if (get().loading) set({ loading: false });
    });
    return inFlight;
  },
  setDashboard: (fn) => {
    const current = get().dashboard;
    if (current) set({ dashboard: fn(current) });
  },
  upsertPlan: (plan) => {
    const plans = get().plans ?? [];
    const rest = plans.filter((p) => p.id !== plan.id);
    set({ plans: [...rest, plan].sort((a, b) => Date.parse(a.scheduledFor || a.startedAt) - Date.parse(b.scheduledFor || b.startedAt)) });
  },
  removePlan: (id) => set({ plans: (get().plans ?? []).filter((p) => p.id !== id) }),
  setMyResponse: (id, response) =>
    set({
      plans: (get().plans ?? []).map((p) => {
        if (p.id !== id) return p;
        const going = p.responses.going + (response === 'going' ? 1 : 0) - (p.myResponse === 'going' ? 1 : 0);
        return { ...p, myResponse: response, responses: { ...p.responses, going: Math.max(0, going) } };
      }),
    }),
  setMeetups: (meetups) => set({ meetups }),
}));

export type HomeEvening = { activityId: string; hostName: string; startedAt: string };

/**
 * The friend's home I said I am at ("Jsem u Kláry"). Kept on the phone so the
 * counter still knows after a restart without signal. The štamgast counter
 * reads it to log drinks there with `placeContext: 'private'`.
 */
export const useHomeEveningStore = create<{
  evening: HomeEvening | null;
  setEvening: (evening: HomeEvening | null) => void;
}>()(
  persist(
    (set) => ({
      evening: null,
      setEvening: (evening) => set({ evening }),
    }),
    { name: 'na-pivo-nv-home-evening', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
