import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { runGlance } from './glance';
import type { TourRun, TourStop } from './model';

/** The unmarked stop of a current run the counter's pub is, if any. Matches the same geohash cell the counter files drinks under. */
export function tourStopAtPub(run: TourRun | null, pubKey: string, pubId?: string, now = Date.now()): { stop: TourStop; number: number } | null {
  if (!run || !runGlance(run, now)) return null;
  const index = run.snapshot.stops.findIndex((stop) => !run.statuses[stop.id] && ((stop.cacheKey ?? geohash8(stop.lat, stop.lon)) === pubKey || (!!pubId && stop.pubId === pubId)));
  return index < 0 ? null : { stop: run.snapshot.stops[index], number: index + 1 };
}

export function pubFromStop(stop: TourStop): Pub {
  return { id: stop.pubId, name: stop.name, lat: stop.lat, lng: stop.lon, address: stop.address || undefined };
}

/** Beers counted at a stop during the run, across the live and archived sittings; a finished run ignores later visits. */
export function beersAtStop(stop: TourStop, run: Pick<TourRun, 'startedAt' | 'endedAt'>, sessions: readonly { pubKey: string; drinks: readonly { drinkType?: string; at: string }[] }[]): number {
  const since = Date.parse(run.startedAt);
  const until = run.endedAt ? Date.parse(run.endedAt) : Infinity;
  const cell = stop.cacheKey ?? geohash8(stop.lat, stop.lon);
  return sessions.filter((session) => session.pubKey === cell)
    .reduce((sum, session) => sum + session.drinks.filter((drink) => {
      const at = Date.parse(drink.at);
      return (drink.drinkType ?? 'beer') === 'beer' && at >= since && at <= until;
    }).length, 0);
}
