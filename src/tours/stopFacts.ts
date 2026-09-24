import { useEffect, useMemo, useState } from 'react';
import { DAY_KEYS, parseOsmOpeningHoursToWeeklyHours, type WeeklyHours } from '@/data/communityHours';
import { fetchPubHours } from '@/data/hoursClient';
import { getAllLoadedPubs, type Pub } from '@/data/pubs';
import { intlLocale } from '@/i18n';
import type { TourPlan, TourStop } from './model';

// Streets are rarely straight; this turns the air distance into a walking guess.
const DETOUR = 1.25;
const METERS_PER_MINUTE = 80;

export interface WalkingLeg { meters: number; minutes: number }
export interface StopFacts { hours: WeeklyHours | null; beers: string[] }

function airMeters(a: Pick<TourStop, 'lat' | 'lon'>, b: Pick<TourStop, 'lat' | 'lon'>): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function walkingLeg(a: TourStop, b: TourStop): WalkingLeg {
  const meters = airMeters(a, b) * DETOUR;
  return { meters, minutes: Math.max(1, Math.round(meters / METERS_PER_MINUTE)) };
}

export function formatWalkDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString(intlLocale, { maximumFractionDigits: 1 })} km`;
}

/** The weekday the plan is about: the meetup date, or today without one. A live night out still counts as the previous day before 5:00. */
export function planDay(plan: Pick<TourPlan, 'scheduledDate'>, live = false, clock = new Date()): { day: number; today: boolean } {
  const now = live ? new Date(clock.getTime() - 5 * 3600000) : clock;
  const today = (now.getDay() + 6) % 7;
  if (!plan.scheduledDate) return { day: today, today: true };
  const day = (new Date(`${plan.scheduledDate}T12:00:00Z`).getUTCDay() + 6) % 7;
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { day, today: plan.scheduledDate === local };
}

/** Opening intervals for one weekday, or null when the pub's hours are unknown. */
export function hoursOnDay(hours: WeeklyHours | null, day: number): string[] | null {
  if (!hours || !Object.values(hours).some((intervals) => intervals.length > 0)) return null;
  return hours[DAY_KEYS[day]].map(([start, end]) => `${start}–${end}`);
}

function factsFromPub(pub: Pick<Pub, 'communityHours' | 'openingHours' | 'beers'>): StopFacts {
  return {
    hours: pub.communityHours ?? parseOsmOpeningHoursToWeeklyHours(pub.openingHours),
    beers: (pub.beers ?? []).map((beer) => beer.name).filter(Boolean),
  };
}

/** Hours and taps per stop: known pubs first, then one cache-only server lookup. */
export function useTourStopFacts(stops: readonly TourStop[]): Record<string, StopFacts> {
  const key = stops.map((stop) => `${stop.id}:${stop.pubId}`).join('|');
  const loaded = useMemo(() => {
    const pubs = new Map(getAllLoadedPubs().map((pub) => [pub.id, pub]));
    const out: Record<string, StopFacts> = {};
    for (const stop of stops) {
      const pub = pubs.get(stop.pubId);
      if (pub) out[stop.id] = factsFromPub(pub);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [fetched, setFetched] = useState<Record<string, StopFacts>>({});
  useEffect(() => {
    const controller = new AbortController();
    const pubs = stops.map((stop) => ({ id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lon }));
    void fetchPubHours(pubs, controller.signal, { syncBudget: 0 }).then((results) => {
      if (controller.signal.aborted) return;
      const out: Record<string, StopFacts> = {};
      results.forEach((result, id) => {
        const facts = factsFromPub({ communityHours: result.communityHours ?? undefined, openingHours: result.openingHours, beers: result.beers });
        if (facts.hours || facts.beers.length) out[id] = facts;
      });
      setFetched(out);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => {
    const out = { ...loaded };
    for (const [id, facts] of Object.entries(fetched)) {
      const known = out[id];
      out[id] = { hours: facts.hours ?? known?.hours ?? null, beers: facts.beers.length ? facts.beers : known?.beers ?? [] };
    }
    return out;
  }, [loaded, fetched]);
}
