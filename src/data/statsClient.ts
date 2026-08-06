/**
 * Personal beer-stats read client — GETs the account's durable aggregates from
 * the backend (/v1/me/stats), which mirror the local statsModel rules over the
 * FULL synced drink history. This lets an account holder see lifetime totals,
 * records and per-pub counts that outlive the 50-session local history cap and
 * survive a reinstall.
 *
 * Same best-effort conventions as visitsClient.fetchVisits: a Bearer GET with an
 * 8s timeout that NEVER throws and returns null on ANY failure (dormant backend,
 * no account, network/timeout, non-2xx, malformed body). The "Výkon" screen
 * always renders from local data first and only overlays these when they arrive,
 * so a null here just means "show the local view".
 *
 * Wire format is snake_case; this maps to camelCase. Durations come over the
 * wire in whole SECONDS — the screen converts to ms for its shared formatters.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';

const REQUEST_TIMEOUT_MS = 8000;

/** One pub's lifetime tally as returned by the backend. */
export interface RemotePubTally {
  cacheKey: string;
  name: string;
  beers: number;
  spentCzk: number;
  lastDrankAt: string;
}

/** Personal records from the backend (durations in seconds, null until data). */
export interface RemoteRecords {
  mostBeersInEvening: number;
  mostBeersPubName: string | null;
  mostBeersDate: string | null;
  fastestBeerSeconds: number | null;
  longestEveningSeconds: number | null;
}

export interface RemotePeriodStat {
  period: string;
  beers: number;
  evenings: number;
  spentCzk: number;
  averageBeersPerEvening: number;
}

export interface RemotePeriodStats {
  timezone: string;
  months: RemotePeriodStat[];
  years: RemotePeriodStat[];
}

/** Fixed-width, privacy-safe chart bucket returned additively for the 3.0 profile. */
export interface RemoteTimelineStat {
  period: string;
  beers: number;
  evenings: number;
  distinctPubs: number;
  longestEveningSeconds: number | null;
}

export interface RemoteStatsTimeline {
  days: RemoteTimelineStat[];
  weeks: RemoteTimelineStat[];
  months: RemoteTimelineStat[];
  streak: {
    currentWeeks: number;
    bestWeeks: number;
  };
  windows: {
    week: RemoteTimelineWindow;
    month: RemoteTimelineWindow;
    year: RemoteTimelineWindow;
  } | null;
}

export type RemoteTimelineWindow = Omit<RemoteTimelineStat, 'period'>;

/** The account's durable beer stats. */
export interface RemoteStats {
  totalBeers: number;
  totalEvenings: number;
  distinctPubs: number;
  totalSpentCzk: number;
  firstDrinkAt: string | null;
  topPubs: RemotePubTally[];
  records: RemoteRecords;
  periods: RemotePeriodStats;
  /** Added in API 3.0; absent against an older compatible backend. */
  timeline?: RemoteStatsTimeline;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parsePub(raw: unknown): RemotePubTally | null {
  const p = raw as Record<string, unknown>;
  if (!p || typeof p.cache_key !== 'string') return null;
  return {
    cacheKey: p.cache_key,
    name: str(p.name),
    beers: num(p.beers),
    spentCzk: num(p.spent_czk),
    lastDrankAt: str(p.last_drank_at),
  };
}

function parsePeriod(raw: unknown): RemotePeriodStat | null {
  const period = raw as Record<string, unknown>;
  if (!period || typeof period.period !== 'string') return null;
  return {
    period: period.period,
    beers: num(period.beers),
    evenings: num(period.evenings),
    spentCzk: num(period.spent_czk),
    averageBeersPerEvening: num(period.average_beers_per_evening),
  };
}

function parseTimelineStat(raw: unknown): RemoteTimelineStat | null {
  const period = raw as Record<string, unknown>;
  if (!period || typeof period.period !== 'string') return null;
  return {
    period: period.period,
    beers: num(period.beers),
    evenings: num(period.evenings),
    distinctPubs: num(period.distinct_pubs),
    longestEveningSeconds: nullableNum(period.longest_evening_seconds),
  };
}

function parseTimelineWindow(raw: unknown): RemoteTimelineWindow {
  const value = (raw ?? {}) as Record<string, unknown>;
  return {
    beers: num(value.beers),
    evenings: num(value.evenings),
    distinctPubs: num(value.distinct_pubs),
    longestEveningSeconds: nullableNum(value.longest_evening_seconds),
  };
}

export function parseStatsTimeline(raw: unknown): RemoteStatsTimeline | null {
  if (!raw || typeof raw !== 'object') return null;
  const timeline = raw as Record<string, unknown>;
  const timelineStreak = (timeline.streak ?? {}) as Record<string, unknown>;
  const timelineWindows = (timeline.windows ?? {}) as Record<string, unknown>;
  const parseTimeline = (value: unknown): RemoteTimelineStat[] =>
    Array.isArray(value)
      ? value.map(parseTimelineStat).filter((p): p is RemoteTimelineStat => p != null)
      : [];
  return {
    days: parseTimeline(timeline.days),
    weeks: parseTimeline(timeline.weeks),
    months: parseTimeline(timeline.months),
    streak: {
      currentWeeks: num(timelineStreak.current_weeks),
      bestWeeks: num(timelineStreak.best_weeks),
    },
    windows:
      timelineWindows.week || timelineWindows.month || timelineWindows.year
        ? {
            week: parseTimelineWindow(timelineWindows.week),
            month: parseTimelineWindow(timelineWindows.month),
            year: parseTimelineWindow(timelineWindows.year),
          }
        : null,
  };
}

function parseStats(body: unknown): RemoteStats | null {
  const b = body as Record<string, unknown>;
  if (!b || typeof b !== 'object') return null;
  const records = (b.records ?? {}) as Record<string, unknown>;
  const topPubs = Array.isArray(b.top_pubs)
    ? b.top_pubs.map(parsePub).filter((p): p is RemotePubTally => p != null)
    : [];
  const periods = (b.periods ?? {}) as Record<string, unknown>;
  const months = Array.isArray(periods.months)
    ? periods.months.map(parsePeriod).filter((p): p is RemotePeriodStat => p != null)
    : [];
  const years = Array.isArray(periods.years)
    ? periods.years.map(parsePeriod).filter((p): p is RemotePeriodStat => p != null)
    : [];
  const timeline = parseStatsTimeline(b.timeline);

  return {
    totalBeers: num(b.total_beers),
    totalEvenings: num(b.total_evenings),
    distinctPubs: num(b.distinct_pubs),
    totalSpentCzk: num(b.total_spent_czk),
    firstDrinkAt: nullableStr(b.first_drink_at),
    topPubs,
    records: {
      mostBeersInEvening: num(records.most_beers_in_evening),
      mostBeersPubName: nullableStr(records.most_beers_pub_name),
      mostBeersDate: nullableStr(records.most_beers_date),
      fastestBeerSeconds: nullableNum(records.fastest_beer_seconds),
      longestEveningSeconds: nullableNum(records.longest_evening_seconds),
    },
    periods: {
      timezone: str(periods.timezone),
      months,
      years,
    },
    timeline: timeline ?? {
      days: [],
      weeks: [],
      months: [],
      streak: { currentWeeks: 0, bestWeeks: 0 },
      windows: null,
    },
  };
}

function deviceTimezone(): string | null {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timezone === 'string' && timezone.length > 0 ? timezone : null;
  } catch {
    return null;
  }
}

/**
 * GET the account's durable beer stats, or null on any failure. Never throws.
 */
export async function fetchMyStats(signal?: AbortSignal): Promise<RemoteStats | null> {
  if (signal?.aborted) return null;

  const baseEndpoint = getBackendEndpoint('/v1/me/stats');
  if (!baseEndpoint) return null;
  const timezone = deviceTimezone();
  const endpoint = timezone
    ? `${baseEndpoint}${baseEndpoint.includes('?') ? '&' : '?'}timezone=${encodeURIComponent(timezone)}`
    : baseEndpoint;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'stats_fetch',
        endpoint: '/v1/me/stats',
      });
      return null;
    }
    if (!resp.ok) return null;

    return parseStats(await resp.json());
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}
