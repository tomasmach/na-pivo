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

import { byPlanTime, livePingPlans } from './partaModel';

type PartaState = {
  dashboard: FriendsDashboard | null;
  plans: PartaPlan[] | null;
  /** Rows in `plans` that are dashboard pub pings, not new-look plans: they cannot be edited. */
  pingIds: string[];
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
  pingIds: [],
  loading: false,
  failed: false,
  generation: snapshotGeneration(),
  meetups: null,

  load: () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const generation = snapshotGeneration();
      // An account switch must not show the previous account's crew.
      if (generation !== get().generation) set({ dashboard: null, plans: null, pingIds: [], meetups: null, generation });
      set({ loading: true });
      const sameAccount = () => generation === snapshotGeneration();
      const dashboardRequest = fetchFriendsDashboard();
      // Invitations show as soon as they arrive; the dashboard is the heavier request.
      const plansRequest = fetchPartaPlans().then((plans) => {
        if (!plans || !sameAccount()) return plans;
        const { plans: shown, pingIds } = get();
        const knownPings = (shown ?? []).filter((p) => pingIds.includes(p.id));
        set({ plans: [...plans, ...knownPings].sort(byPlanTime) });
        return plans;
      });
      await showSavedCopies(generation);
      const [dashboard, plans] = await Promise.all([dashboardRequest, plansRequest]);
      if (!sameAccount()) return;
      // Live pub pings come only with the dashboard, so they join the invitations here.
      const pingSource = dashboard ?? get().dashboard;
      const pings = plans && pingSource ? livePingPlans(pingSource, plans) : null;
      set({
        dashboard: dashboard ?? get().dashboard,
        plans: plans ? [...plans, ...(pings ?? [])].sort(byPlanTime) : get().plans,
        ...(plans ? { pingIds: (pings ?? []).map((ping) => ping.id) } : {}),
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
    set({ plans: [...rest, plan].sort(byPlanTime) });
  },
  removePlan: (id) => set({ plans: (get().plans ?? []).filter((p) => p.id !== id), pingIds: get().pingIds.filter((pingId) => pingId !== id) }),
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
