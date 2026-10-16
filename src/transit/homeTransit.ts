import { haversineMeters, type LatLng } from '@/compass/distance';
import { intlLocale } from '@/i18n';

/** One public-transport stop from the cached PID list. */
export interface TransitStopPoint {
  id: string;
  lat: number;
  lng: number;
}

/** The last direct connection from the pub towards home tonight. */
export interface HomeTransitDeparture {
  line: string;
  headsign: string;
  /** GTFS route_type: 0 tram, 1 metro, 2 train, 3 bus, …; null when unknown. */
  routeType: number | null;
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  departsAtMs: number;
}

/** Stops this close to home count as "home". Only their ids leave the phone. */
export const HOME_STOP_RADIUS_M = 700;
/** The server accepts at most this many ids; the nearest ones win. */
export const MAX_HOME_STOP_IDS = 80;

/**
 * Ids of the stops around home, nearest first. Computed on the phone so the
 * home point itself never reaches the server.
 */
export function stopIdsNearHome(
  stops: readonly TransitStopPoint[],
  home: LatLng,
  radiusM: number = HOME_STOP_RADIUS_M,
): string[] {
  // A cheap box filter first; the exact distance only for the few candidates.
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(Math.cos((home.lat * Math.PI) / 180), 0.01));
  return stops
    .filter(
      (stop) =>
        Math.abs(stop.lat - home.lat) <= latDelta && Math.abs(stop.lng - home.lng) <= lngDelta,
    )
    .map((stop) => ({ id: stop.id, distance: haversineMeters(home, stop) }))
    .filter((stop) => stop.distance <= radiusM)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_HOME_STOP_IDS)
    .map((stop) => stop.id);
}

/** A connection is worth showing only until it leaves. */
export function isUpcomingDeparture(
  departure: HomeTransitDeparture | null | undefined,
  nowMs: number = Date.now(),
): departure is HomeTransitDeparture {
  return !!departure && departure.departsAtMs > nowMs;
}

/** Wall-clock departure such as "23:58" in the app language. */
export function formatDepartureTime(departsAtMs: number): string {
  return new Date(departsAtMs).toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * IDOS search between the two stops. Stop names only, never the home point.
 * The PID timetable, because the national one asks which "Anděl" you mean.
 */
export function idosConnectionUrl(departure: HomeTransitDeparture): string {
  const from = encodeURIComponent(departure.fromStopName);
  const to = encodeURIComponent(departure.toStopName);
  return `https://idos.cz/pid/spojeni/vysledky/?f=${from}&t=${to}`;
}
