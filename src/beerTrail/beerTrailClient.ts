import { clearCachedAnonymousAccount, ensureAccount } from '@/data/account';
import { getBackendEndpoint } from '@/data/backendConfig';
import { trackApiFailure } from '@/data/telemetryClient';

export interface BeerTrailTeaser {
  distinctPubs: number;
  citiesCount: number;
  visitsCount: number;
  totalBeers: number;
}

export interface BeerTrailEntitlement {
  tier: 'free' | 'plus';
  status: 'inactive' | 'pending_verification' | 'active' | 'grace_period' | 'expired';
  isPlus: boolean;
}

export interface BeerTrailPeriod {
  kind: 'month' | 'year';
  year: number;
  month: number | null;
  startAt: string;
  endAt: string;
}

export interface BeerTrailPub {
  cacheKey: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  visitsCount: number;
  beersCount: number;
  totalSpentCzk: number;
  averagePriceCzk: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  isReturning: boolean;
}

export interface BeerTrailCity {
  name: string;
  visitsCount: number;
  pubsCount: number;
  beersCount: number;
}

export interface BeerTrailReport {
  kind: 'month' | 'year';
  year: number;
  month: number | null;
  startAt: string;
  endAt: string;
  pubsCount: number;
  citiesCount: number;
  visitsCount: number;
  totalBeers: number;
  totalSpentCzk: number;
  averagePriceCzk: number | null;
  minPriceCzk: number | null;
  maxPriceCzk: number | null;
  topPub: Pick<BeerTrailPub, 'cacheKey' | 'name' | 'city' | 'visitsCount' | 'beersCount'> | null;
  topBeer: { name: string; count: number } | null;
  discovery: Pick<BeerTrailPub, 'cacheKey' | 'name' | 'city' | 'firstSeenAt'> | null;
  verdict: string;
  share: { title: string; lines: string[] };
}

export interface BeerTrailSnapshot {
  entitlement: BeerTrailEntitlement;
  teaser: BeerTrailTeaser;
  locked: boolean;
  period: BeerTrailPeriod;
  trail?: {
    pubs: BeerTrailPub[];
    cities: BeerTrailCity[];
    favorites: BeerTrailPub[];
    returningPubs: BeerTrailPub[];
    nudge: string;
  };
  report?: BeerTrailReport;
}

const REQUEST_TIMEOUT_MS = 8000;

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function boolOr(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function periodFromRaw(raw: Record<string, unknown>): BeerTrailPeriod {
  const kind = raw.kind === 'year' ? 'year' : 'month';
  return {
    kind,
    year: numberOr(raw.year),
    month: typeof raw.month === 'number' ? raw.month : null,
    startAt: stringOr(raw.start_at),
    endAt: stringOr(raw.end_at),
  };
}

function pubFromRaw(raw: unknown): BeerTrailPub {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    cacheKey: stringOr(row.cache_key),
    name: stringOr(row.name),
    city: stringOr(row.city),
    lat: numberOr(row.lat),
    lng: numberOr(row.lng),
    visitsCount: numberOr(row.visits_count),
    beersCount: numberOr(row.beers_count),
    totalSpentCzk: numberOr(row.total_spent_czk),
    averagePriceCzk: typeof row.average_price_czk === 'number' ? row.average_price_czk : null,
    firstSeenAt: nullableString(row.first_seen_at),
    lastSeenAt: nullableString(row.last_seen_at),
    isReturning: boolOr(row.is_returning),
  };
}

function cityFromRaw(raw: unknown): BeerTrailCity {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    name: stringOr(row.name),
    visitsCount: numberOr(row.visits_count),
    pubsCount: numberOr(row.pubs_count),
    beersCount: numberOr(row.beers_count),
  };
}

function topPubFromRaw(raw: unknown): BeerTrailReport['topPub'] {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    cacheKey: stringOr(row.cache_key),
    name: stringOr(row.name),
    city: stringOr(row.city),
    visitsCount: numberOr(row.visits_count),
    beersCount: numberOr(row.beers_count),
  };
}

function discoveryFromRaw(raw: unknown): BeerTrailReport['discovery'] {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    cacheKey: stringOr(row.cache_key),
    name: stringOr(row.name),
    city: stringOr(row.city),
    firstSeenAt: nullableString(row.first_seen_at),
  };
}

function reportFromRaw(raw: unknown): BeerTrailReport | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  const share = (row.share ?? {}) as Record<string, unknown>;
  const topBeer = row.top_beer && typeof row.top_beer === 'object'
    ? (row.top_beer as Record<string, unknown>)
    : null;
  return {
    ...periodFromRaw(row),
    pubsCount: numberOr(row.pubs_count),
    citiesCount: numberOr(row.cities_count),
    visitsCount: numberOr(row.visits_count),
    totalBeers: numberOr(row.total_beers),
    totalSpentCzk: numberOr(row.total_spent_czk),
    averagePriceCzk: typeof row.average_price_czk === 'number' ? row.average_price_czk : null,
    minPriceCzk: typeof row.min_price_czk === 'number' ? row.min_price_czk : null,
    maxPriceCzk: typeof row.max_price_czk === 'number' ? row.max_price_czk : null,
    topPub: topPubFromRaw(row.top_pub),
    topBeer: topBeer ? { name: stringOr(topBeer.name), count: numberOr(topBeer.count) } : null,
    discovery: discoveryFromRaw(row.discovery),
    verdict: stringOr(row.verdict),
    share: {
      title: stringOr(share.title),
      lines: Array.isArray(share.lines) ? share.lines.filter((line): line is string => typeof line === 'string') : [],
    },
  };
}

function snapshotFromRaw(raw: Record<string, unknown>): BeerTrailSnapshot {
  const entitlement = (raw.entitlement ?? {}) as Record<string, unknown>;
  const teaser = (raw.teaser ?? {}) as Record<string, unknown>;
  const trail = raw.trail && typeof raw.trail === 'object'
    ? (raw.trail as Record<string, unknown>)
    : null;
  const snapshot: BeerTrailSnapshot = {
    entitlement: {
      tier: entitlement.tier === 'plus' ? 'plus' : 'free',
      status: (
        ['inactive', 'pending_verification', 'active', 'grace_period', 'expired'].includes(
          String(entitlement.status),
        )
          ? entitlement.status
          : 'inactive'
      ) as BeerTrailEntitlement['status'],
      isPlus: entitlement.is_plus === true,
    },
    teaser: {
      distinctPubs: numberOr(teaser.distinct_pubs),
      citiesCount: numberOr(teaser.cities_count),
      visitsCount: numberOr(teaser.visits_count),
      totalBeers: numberOr(teaser.total_beers),
    },
    locked: raw.locked !== false,
    period: periodFromRaw((raw.period ?? {}) as Record<string, unknown>),
  };
  if (trail) {
    snapshot.trail = {
      pubs: Array.isArray(trail.pubs) ? trail.pubs.map(pubFromRaw) : [],
      cities: Array.isArray(trail.cities) ? trail.cities.map(cityFromRaw) : [],
      favorites: Array.isArray(trail.favorites) ? trail.favorites.map(pubFromRaw) : [],
      returningPubs: Array.isArray(trail.returning_pubs) ? trail.returning_pubs.map(pubFromRaw) : [],
      nudge: stringOr(trail.nudge),
    };
  }
  const report = reportFromRaw(raw.report);
  if (report) snapshot.report = report;
  return snapshot;
}

export async function fetchBeerTrailSnapshot(options?: {
  period?: 'month' | 'year';
  year?: number;
  month?: number;
  signal?: AbortSignal;
}): Promise<BeerTrailSnapshot | null> {
  const params = new URLSearchParams();
  if (options?.period) params.set('period', options.period);
  if (typeof options?.year === 'number') params.set('year', String(options.year));
  if (typeof options?.month === 'number') params.set('month', String(options.month));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const endpoint = getBackendEndpoint(`/v1/account/beer-trail${suffix}`);
  if (!endpoint || options?.signal?.aborted) return null;

  const session = await ensureAccount(options?.signal);
  if (!session || options?.signal?.aborted) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (options?.signal) options.signal.addEventListener('abort', onExternalAbort);

  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: controller.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session);
      return null;
    }
    if (!resp.ok) return null;
    const data = (await resp.json()) as Record<string, unknown>;
    return snapshotFromRaw(data);
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!isAbort) {
      trackApiFailure('beer_trail_fetch', { endpoint: '/v1/account/beer-trail', reason: 'exception', error: err });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
    if (options?.signal) options.signal.removeEventListener('abort', onExternalAbort);
  }
}
