import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HomeTransitDeparture, TransitStopPoint } from '@/transit/homeTransit';

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

const STOPS_ENDPOINT = '/v1/transit/stops';
const LAST_DIRECT_ENDPOINT = '/v1/transit/last-direct';
// The stop list is about half a megabyte; give a slow pub signal time.
const STOPS_TIMEOUT_MS = 20_000;
const LAST_DIRECT_TIMEOUT_MS = 8_000;
// Stops rarely move. One download a month keeps the copy fresh enough.
const STOPS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A failed download waits before the next try instead of repeating every foreground.
const STOPS_RETRY_AFTER_MS = 30 * 60 * 1000;
// Public PID data shared by every account, so no account boundary clears it.
export const TRANSIT_STOPS_STORAGE_KEY = 'na-pivo-transit-stops-v1';

type StopRow = [string, number, number];

let memory: { fetchedAt: number; stops: TransitStopPoint[] } | null = null;
let deviceCopy: Promise<void> | null = null;
let inFlight: Promise<TransitStopPoint[] | null> | null = null;
let lastFailureAt = 0;

/** Reads `{stops: [[id, lat, lng], ...]}`; malformed rows are skipped. */
export function parseTransitStops(data: unknown): TransitStopPoint[] | null {
  const rows = (data as { stops?: unknown } | null)?.stops;
  if (!Array.isArray(rows)) return null;
  const stops: TransitStopPoint[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [id, lat, lng] = row as unknown[];
    if (
      typeof id === 'string' &&
      id.length > 0 &&
      id.length <= 32 &&
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {
      stops.push({ id, lat, lng });
    }
  }
  return stops;
}

/** The departure, null when none is left tonight, undefined for a malformed body. */
export function parseLastDirect(data: unknown): HomeTransitDeparture | null | undefined {
  if (!data || typeof data !== 'object' || !('departure' in data)) return undefined;
  const value = (data as { departure?: unknown }).departure;
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');
  const departure: HomeTransitDeparture = {
    line: text('line'),
    headsign: text('headsign'),
    routeType: typeof raw.route_type === 'number' ? raw.route_type : null,
    fromStopId: text('from_stop_id'),
    fromStopName: text('from_stop_name'),
    toStopId: text('to_stop_id'),
    toStopName: text('to_stop_name'),
    departsAtMs: Date.parse(text('departs_at')),
  };
  if (!Number.isFinite(departure.departsAtMs) || !departure.fromStopName || !departure.toStopName) {
    return undefined;
  }
  return departure;
}

function loadDeviceCopy(): Promise<void> {
  deviceCopy ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(TRANSIT_STOPS_STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as { fetchedAt?: unknown } | null) : null;
      const stops = parseTransitStops(stored);
      const fetchedAt = stored?.fetchedAt;
      if (!stops?.length || typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt)) return;
      // A clock that ran ahead when the copy was saved must not keep it for months.
      memory ??= { fetchedAt: Math.min(fetchedAt, Date.now()), stops };
    } catch {
      // A convenience copy; when it cannot be read the list comes from the network.
    }
  })();
  return deviceCopy;
}

async function downloadStops(): Promise<TransitStopPoint[] | null> {
  const endpoint = getBackendEndpoint(STOPS_ENDPOINT);
  if (!endpoint) return null;
  const session = await ensureAccount();
  if (!session) return null;

  const abort = chainAbortSignal(undefined, STOPS_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'transit_stops_fetch',
        endpoint: STOPS_ENDPOINT,
      });
      return null;
    }
    if (!resp.ok) {
      // 503 only means the server has no timetable yet.
      if (resp.status !== 503) {
        trackApiFailure('transit_stops_fetch', { endpoint: STOPS_ENDPOINT, status: resp.status });
      }
      return null;
    }
    const stops = parseTransitStops(await resp.json());
    if (!stops?.length) return null;
    memory = { fetchedAt: Date.now(), stops };
    const rows: StopRow[] = stops.map((stop) => [stop.id, stop.lat, stop.lng]);
    void AsyncStorage.setItem(
      TRANSIT_STOPS_STORAGE_KEY,
      JSON.stringify({ fetchedAt: memory.fetchedAt, stops: rows }),
    ).catch(() => undefined);
    return stops;
  } catch (err) {
    if (!(err instanceof Error && err.name === 'AbortError')) {
      trackApiFailure('transit_stops_fetch', {
        endpoint: STOPS_ENDPOINT,
        reason: 'exception',
        error: err,
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}

/**
 * PID stops, downloaded once and kept on the phone. An older copy still answers
 * while a refresh fails; null only when there has never been a list.
 */
export async function loadTransitStops(): Promise<TransitStopPoint[] | null> {
  await loadDeviceCopy();
  const now = Date.now();
  if (memory && now - memory.fetchedAt < STOPS_MAX_AGE_MS) return memory.stops;
  if (now - lastFailureAt < STOPS_RETRY_AFTER_MS) return memory?.stops ?? null;

  inFlight ??= downloadStops().finally(() => {
    inFlight = null;
  });
  const stops = await inFlight;
  if (!stops) lastFailureAt = Date.now();
  return stops ?? memory?.stops ?? null;
}

export type LastDirectResult = { ok: true; departure: HomeTransitDeparture | null } | { ok: false };

/**
 * The last direct connection tonight from a stop near the pub to one of the
 * home stops. Only the pub point and stop ids are sent. Never throws.
 */
export async function fetchLastDirectDeparture(
  params: { fromLat: number; fromLng: number; toStopIds: readonly string[] },
  signal?: AbortSignal,
): Promise<LastDirectResult> {
  const base = getBackendEndpoint(LAST_DIRECT_ENDPOINT);
  if (!base || params.toStopIds.length === 0 || signal?.aborted) return { ok: false };
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return { ok: false };

  const query =
    `from_lat=${params.fromLat.toFixed(5)}&from_lng=${params.fromLng.toFixed(5)}` +
    `&to_stop_ids=${params.toStopIds.map(encodeURIComponent).join(',')}`;
  const abort = chainAbortSignal(signal, LAST_DIRECT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}?${query}`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'transit_last_direct_fetch',
        endpoint: LAST_DIRECT_ENDPOINT,
      });
      return { ok: false };
    }
    if (!resp.ok) {
      if (resp.status !== 503 && resp.status !== 429) {
        trackApiFailure('transit_last_direct_fetch', {
          endpoint: LAST_DIRECT_ENDPOINT,
          status: resp.status,
        });
      }
      return { ok: false };
    }
    const departure = parseLastDirect(await resp.json());
    return departure === undefined ? { ok: false } : { ok: true, departure };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbort) {
      trackApiFailure('transit_last_direct_fetch', {
        endpoint: LAST_DIRECT_ENDPOINT,
        reason: 'exception',
        error: err,
      });
    }
    return { ok: false };
  } finally {
    abort.cleanup();
  }
}

/** Test hook. */
export function resetTransitClientCache(): void {
  memory = null;
  deviceCopy = null;
  inFlight = null;
  lastFailureAt = 0;
}
