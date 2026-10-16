import { RUN_GLANCE_MS, runGlance, sortPlans, upcomingPlan } from '../glance';
import type { TourPlan, TourRun } from '../model';

const stop = (n: number) => ({ id: `s${n}`, pubId: `p${n}`, cacheKey: null, name: `Hospoda ${n}`, address: '', lat: 50 + n / 100, lon: 14 });
const plan = (id: string, scheduledDate: string | null, updatedAt = '2026-09-01T10:00:00Z', scheduledTime: string | null = null): TourPlan => ({
  id, title: id, scheduledDate, scheduledTime, timezone: 'Europe/Prague', stops: [stop(1), stop(2), stop(3)], revision: 1, updatedAt,
});
const now = new Date('2026-09-24T12:00:00');

it('describes the next stop and the walk from the last visited one', () => {
  const run: TourRun = { id: 'r', planId: 'a', snapshot: plan('a', null), startedAt: now.toISOString(), endedAt: null, statuses: { s1: 'visited', s2: 'skipped' } };
  const glance = runGlance(run, now.getTime())!;
  expect(glance.next?.id).toBe('s3');
  expect(glance.visited).toBe(1);
  // 1 → 3 is 2.2 km of air distance; the skipped stop does not shorten the walk.
  expect(glance.minutes).toBe(35);
});

it('stops speaking about a forgotten run after twelve hours', () => {
  const run: TourRun = { id: 'r', planId: 'a', snapshot: plan('a', null), startedAt: now.toISOString(), endedAt: null, statuses: {} };
  expect(runGlance(run, now.getTime() + RUN_GLANCE_MS)).not.toBeNull();
  expect(runGlance(run, now.getTime() + RUN_GLANCE_MS + 1)).toBeNull();
});

it('orders upcoming meetups first and picks the soonest one that is not being walked', () => {
  const plans = [plan('undated', null, '2026-09-20T10:00:00Z'), plan('past', '2026-09-01', '2026-09-23T10:00:00Z'),
    plan('late', '2026-10-02'), plan('soon', '2026-09-26', undefined, '18:00'), plan('today', '2026-09-24')];
  expect(sortPlans(plans, now).map((p) => p.id)).toEqual(['today', 'soon', 'late', 'past', 'undated']);
  expect(upcomingPlan(plans, 'today', now)?.id).toBe('soon');
  expect(upcomingPlan([plan('undated', null)], undefined, now)).toBeUndefined();
});
