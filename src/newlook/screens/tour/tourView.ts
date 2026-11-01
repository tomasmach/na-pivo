import type { Href, useRouter } from 'expo-router';
import { create } from 'zustand';

import { intlLocale, t } from '@/i18n';
import { pubPageParams } from '@/pubPage/openPubPage';
import { useCounterHandoffStore } from '@/stores/counterHandoffStore';
import { useToursStore } from '@/stores/toursStore';
import { pubFromStop } from '@/tours/counterLink';
import { tourError } from '@/tours/TourChrome';

import { toast } from '../../ui/store';
import type { TourPlan, TourRun, TourStop } from '@/tours/model';
import { formatWalkDistance, hoursOnDay, planDay, type StopFacts, walkingDistance, walkingLeg } from '@/tours/stopFacts';
import { whenLabel } from '@/tours/when';
import { openPubInMaps } from '@/utils/maps';

type Router = ReturnType<typeof useRouter>;

export type StopState = 'todo' | 'visited' | 'skipped';

export function stopStates(stops: readonly TourStop[], statuses?: TourRun['statuses']): StopState[] {
  return stops.map((stop) => statuses?.[stop.id] ?? 'todo');
}

export const nextStopIndex = (states: readonly StopState[]) => states.indexOf('todo');

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(intlLocale) + text.slice(1);

/** "Pá 6. 11. · 20:00", or null without a meetup. */
export function whenText(plan: Pick<TourPlan, 'scheduledDate' | 'scheduledTime' | 'timezone'>): string | null {
  const label = whenLabel(plan);
  return label ? capitalize(label) : null;
}

/** The date block of a plan ticket. */
export function ticketDay(plan: Pick<TourPlan, 'scheduledDate' | 'scheduledTime'>): { dayNum: string; dayName: string; time: string } {
  if (!plan.scheduledDate) return { dayNum: '–', dayName: t.tours.optional, time: '' };
  const date = new Date(`${plan.scheduledDate}T12:00:00Z`);
  return {
    dayNum: String(date.getUTCDate()),
    dayName: capitalize(date.toLocaleDateString(intlLocale, { weekday: 'long', timeZone: 'UTC' })),
    time: plan.scheduledTime ?? '',
  };
}

/** "5 hospod, asi 2,1 km pěšky" */
export function planSummary(stops: readonly TourStop[]): string {
  return t.nv.tour.summary(stops.length, formatWalkDistance(walkingDistance(stops)));
}

/** Minutes on foot from one stop to the next, a straight line with a detour factor. */
export const legMinutes = (from: TourStop, to: TourStop) => walkingLeg(from, to).minutes;

export type FactsLine = { hours?: string; closed?: boolean; beers?: string };

/** Opening hours on the day the stops are about, and what they pour. */
export function factsLines(stops: readonly TourStop[], facts: Record<string, StopFacts>, scheduledDate: string | null, live: boolean): Record<string, FactsLine> {
  const { day, today } = planDay({ scheduledDate: live ? null : scheduledDate }, live);
  const dayLabel = today ? t.tours.today : t.tours.onDay[day];
  const out: Record<string, FactsLine> = {};
  for (const stop of stops) {
    const known = facts[stop.id];
    if (!known) continue;
    const intervals = hoursOnDay(known.hours, day);
    out[stop.id] = {
      hours: intervals ? (intervals.length ? `${dayLabel} ${intervals.join(', ')}` : t.tours.closedOn(dayLabel)) : undefined,
      closed: !!intervals && !intervals.length,
      beers: known.beers.slice(0, 2).join(', ') || undefined,
    };
  }
  return out;
}

export function navigateToStop(stop: TourStop, onError: () => void): void {
  void openPubInMaps({ lat: stop.lat, lng: stop.lon, name: stop.name }).catch(onError);
}

/** The counter opens on the stop's pub; a beer logged there checks the stop off. */
export function logBeerAtStop(router: Router, stop: TourStop): void {
  useCounterHandoffStore.getState().handOff(pubFromStop(stop));
  router.navigate('/nv/stamgast' as Href);
}

type LastMark = { runId: string; stopId: string; status: 'visited' | 'skipped' | null; previous: 'visited' | 'skipped' | null };

/** The last check-off made on a tour screen, so the run can offer to take it back. */
export const useLastMark = create<{ mark: LastMark | null }>(() => ({ mark: null }));

export async function markRunStop(stopId: string, status: 'visited' | 'skipped' | null): Promise<boolean> {
  const run = useToursStore.getState().activeRun;
  if (!run) return false;
  const previous = run.statuses[stopId] ?? null;
  const result = await useToursStore.getState().markStop(stopId, status);
  if (!result.ok) {
    toast({ kind: 'error', title: tourError(result.error) ?? t.tours.errors.storage });
    return false;
  }
  useLastMark.setState({ mark: { runId: run.id, stopId, status, previous } });
  const after = useToursStore.getState().activeRun;
  if (status && previous === null && after && after.snapshot.stops.every((stop) => after.statuses[stop.id])) {
    toast({ kind: 'saved', title: t.nv.tour.lastStop, icon: 'flag' });
  }
  return true;
}

export function openStopPub(router: Router, stop: TourStop, replace = false): void {
  const params = { id: stop.pubId, ...pubPageParams(pubFromStop(stop)) };
  const href = { pathname: '/nv/hospoda/[id]', params } as unknown as Href;
  if (replace) router.replace(href);
  else router.push(href);
}
