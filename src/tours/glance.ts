import { runPosition, type TourPlan, type TourRun, type TourStop } from './model';
import { walkingLeg } from './stopFacts';

/** A forgotten run stops speaking outside the tour after this long. */
export const RUN_GLANCE_MS = 12 * 3600000;

export interface RunGlance { planId: string; title: string; visited: number; total: number; next?: TourStop; minutes?: number }

/** What other screens say about a running tour, or null when there is nothing current to say. */
export function runGlance(run: TourRun | null, now = Date.now()): RunGlance | null {
  return run && now - Date.parse(run.startedAt) <= RUN_GLANCE_MS ? describeRun(run) : null;
}

export function describeRun(run: TourRun): RunGlance {
  const { next, here } = runPosition(run);
  return {
    planId: run.planId, title: run.snapshot.title, next,
    visited: Object.values(run.statuses).filter((status) => status === 'visited').length,
    total: run.snapshot.stops.length,
    minutes: here && next ? walkingLeg(here, next).minutes : undefined,
  };
}

function localDate(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The soonest dated plan from today on, excluding the one being walked. */
export function upcomingPlan(plans: readonly TourPlan[], activePlanId?: string, now = new Date()): TourPlan | undefined {
  const today = localDate(now);
  return sortPlans(plans.filter((plan) => plan.id !== activePlanId), now).find((plan) => !!plan.scheduledDate && plan.scheduledDate >= today);
}

/** Upcoming meetups first by date, then everything else by last change. */
export function sortPlans(plans: readonly TourPlan[], now = new Date()): TourPlan[] {
  const today = localDate(now);
  const upcoming = (plan: TourPlan) => !!plan.scheduledDate && plan.scheduledDate >= today;
  return [...plans].sort((a, b) => {
    if (upcoming(a) && upcoming(b)) return `${a.scheduledDate}${a.scheduledTime ?? ''}`.localeCompare(`${b.scheduledDate}${b.scheduledTime ?? ''}`);
    if (upcoming(a) !== upcoming(b)) return upcoming(a) ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
