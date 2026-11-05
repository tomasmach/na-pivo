import { create } from 'zustand';

import {
  fetchFriendsDashboard,
  markFriendNotificationsRead,
  type ActivityResponseKind,
  type FriendsDashboard,
} from '@/data/friendsClient';
import {
  loadFriendsDashboardSnapshot,
  loadPartaPlansSnapshot,
  savePartaPlansSnapshot,
  snapshotGeneration,
} from '@/data/friendsSnapshot';
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
  /** A load that starts after any one already running, so it sees changes made since. */
  reload: () => Promise<void>;
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
      set({ loading: true });
      const sameAccount = () => generation === snapshotGeneration();
      const dashboardRequest = fetchFriendsDashboard();
      // Invitations show as soon as they arrive; the dashboard is the heavier request.
      const plansRequest = fetchPartaPlans().then((plans) => {
        if (plans && sameAccount()) set({ plans });
        return plans;
      });
      await showSavedCopies(generation);
      const [dashboard, plans] = await Promise.all([dashboardRequest, plansRequest]);
      if (!sameAccount()) return;
      set({
        dashboard: dashboard ?? get().dashboard,
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
  reload: () => (inFlight ? inFlight.then(() => get().load()) : get().load()),
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

async function showSavedCopies(generation: number): Promise<void> {
  const { dashboard, plans } = usePartaStore.getState();
  const [savedDashboard, savedPlans] = await Promise.all([
    dashboard ? null : loadFriendsDashboardSnapshot(),
    plans ? null : loadPartaPlansSnapshot(),
  ]);
  if (generation !== snapshotGeneration()) return;
  const state = usePartaStore.getState();
  if (savedDashboard && !state.dashboard) usePartaStore.setState({ dashboard: savedDashboard.dashboard });
  if (savedPlans && !state.plans) usePartaStore.setState({ plans: savedPlans });
}

// Reading storage takes a moment on a cold start; doing it now means opening Parta doesn't wait for it.
void showSavedCopies(snapshotGeneration());

usePartaStore.subscribe((state, previous) => {
  if (state.plans && state.plans !== previous.plans) void savePartaPlansSnapshot(state.plans, state.generation);
});
