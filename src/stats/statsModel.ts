/**
 * Pure read-model helpers for "Výkon" — the personal beer-stats surface.
 *
 * Like eveningModel, everything here derives purely from the local TallySessions
 * the counter already produces (tallyStore: `current` + `history`) — no new
 * persistence, no backend. Kept pure + side-effect-free so the screen and tests
 * can rely on it offline and without an account.
 *
 * This module is the CANONICAL definition of how a beer-stat is computed. The
 * backend's /v1/me/stats endpoint mirrors the same rules over the synced drink
 * history so an account holder's durable numbers (which can outlive the 50-
 * session local cap) line up with what the device computes locally:
 *   • an "evening" = one TallySession = drinks at one pub on one drinking day,
 *     where the drinking day rolls at 04:00 local (the counter's existing rule);
 *   • within an evening, drinks are ordered by their own timestamp `at`;
 *   • the evening's duration = last drink − first drink;
 *   • the gap between two consecutive drinks is the "drinking pace"; the average
 *     gap = duration / (beers − 1), and the smallest gap = the fastest beer.
 *
 * Deliberately restrained: lifetime totals, personal records, and per-pub counts
 * — the everyday "how was last night" surface. The big yearly/monthly
 * retrospective is intentionally left for the year-end Pivní Wrapped.
 */

import {
  sessionCount,
  sessionTotalCzk,
  sessionLastActivityMs,
  allSessionsNewestFirst,
  type TallySession,
} from '@/stores/tallyStore';
import { eveningDayRelation } from '@/myBeers/eveningModel';
import { isContextPubKey, normalizeDrinkType } from '@/drinks/drinkTypes';
import { MIN_PLAUSIBLE_BEER_GAP_MS } from '@/drinks/drinkTiming';

/** A drink count threshold bucket, used to pick the hospodský one-liner that
 *  reacts to last night's tally. Ordered from gentle to legendary. */
export type PerformanceTone = 'start' | 'warmup' | 'solid' | 'big' | 'huge';

/** Last night's (or today's) performance — the "ráno koukni na výkon" hero.
 *  Null when the newest evening is older than yesterday (nothing fresh to show). */
export interface LastPerformance {
  /** Only 'today' or 'yesterday' — older evenings don't get a hero. */
  relation: 'today' | 'yesterday';
  startedAt: string;
  pubName: string;
  pubKey: string;
  beers: number;
  spentCzk: number;
  /** Last drink − first drink, in ms. 0 for a single-beer evening. */
  durationMs: number;
  /** Average gap between beers (durationMs / (beers − 1)); null when < 2 beers. */
  avgGapMs: number | null;
  /** Smallest gap between two consecutive beers; null when < 2 beers. */
  fastestGapMs: number | null;
  tone: PerformanceTone;
}

/** Lifetime running totals across every recorded evening. */
export interface LifetimeStats {
  totalBeers: number;
  totalEvenings: number;
  distinctPubs: number;
  totalSpentCzk: number;
}

/** Personal bests — the bragging numbers. Each is null until there's data. */
export interface PersonalRecords {
  mostBeersInEvening: number;
  mostBeersPubName: string | null;
  mostBeersStartedAt: string | null;
  /** Fastest single beer ever = smallest consecutive gap across all evenings. */
  fastestBeerMs: number | null;
  /** Longest evening = largest first→last span across all evenings. */
  longestEveningMs: number | null;
}

/** One pub's lifetime tally — "kolik jsem tu vypil". */
export interface PubTally {
  pubKey: string;
  pubName: string;
  beers: number;
  spentCzk: number;
  /** ISO of the most recent drink here. */
  lastAt: string;
}

/** Drink timestamps (epoch ms) in ascending order, dropping any unparseable. */
function sortedDrinkTimes(session: TallySession, beersOnly = false): number[] {
  const times: number[] = [];
  for (const drink of session.drinks) {
    if (beersOnly && normalizeDrinkType(drink.drinkType) !== 'beer') continue;
    const ms = Date.parse(drink.at);
    if (Number.isFinite(ms)) times.push(ms);
  }
  times.sort((a, b) => a - b);
  return times;
}

/** First→last span of an evening in ms (0 when it holds fewer than 2 drinks). */
export function sessionDurationMs(session: TallySession): number {
  const times = sortedDrinkTimes(session);
  if (times.length < 2) return 0;
  return times[times.length - 1] - times[0];
}

/** Gaps (ms) between consecutive drinks, ascending by time. Empty when < 2. */
export function sessionGapsMs(session: TallySession): number[] {
  const times = sortedDrinkTimes(session, true);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  return gaps;
}

/** Reject duplicate-like intervals before they can become a personal record. */
export function plausibleFastestBeerMs(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= MIN_PLAUSIBLE_BEER_GAP_MS
    ? value
    : null;
}

/** Smallest plausible consecutive beer gap, or null when none qualifies. */
export function sessionFastestGapMs(session: TallySession): number | null {
  const gaps = sessionGapsMs(session);
  if (gaps.length === 0) return null;
  const plausible = gaps.filter((gap) => plausibleFastestBeerMs(gap) != null);
  return plausible.length > 0 ? Math.min(...plausible) : null;
}

/** Bucket a beer count into the tone of its one-liner. */
export function performanceTone(beers: number): PerformanceTone {
  if (beers <= 1) return 'start';
  if (beers <= 3) return 'warmup';
  if (beers <= 6) return 'solid';
  if (beers <= 9) return 'big';
  return 'huge';
}

/**
 * The hero performance: the newest evening, but only when it falls on today or
 * yesterday's drinking day (so a morning-after glance lands on last night).
 * Returns null when there are no evenings or the newest is older than yesterday.
 */
export function computeLastPerformance(
  current: TallySession | null,
  history: TallySession[],
  now: Date,
): LastPerformance | null {
  const sessions = allSessionsNewestFirst(current, history);
  const latest = sessions[0];
  if (!latest) return null;

  const relation = eveningDayRelation(latest.startedAt, now);
  if (relation !== 'today' && relation !== 'yesterday') return null;

  const beers = sessionCount(latest);
  if (beers === 0) return null;

  const durationMs = sessionDurationMs(latest);
  const beerGaps = sessionGapsMs(latest);
  const avgGapMs =
    beerGaps.length > 0
      ? beerGaps.reduce((sum, gap) => sum + gap, 0) / beerGaps.length
      : null;

  return {
    relation,
    startedAt: latest.startedAt,
    pubName: latest.pubName,
    pubKey: latest.pubKey,
    beers,
    spentCzk: sessionTotalCzk(latest),
    durationMs,
    avgGapMs,
    fastestGapMs: sessionFastestGapMs(latest),
    tone: performanceTone(beers),
  };
}

/** Running totals across every recorded evening. */
export function computeLifetime(sessions: TallySession[]): LifetimeStats {
  let totalBeers = 0;
  let totalSpentCzk = 0;
  const pubKeys = new Set<string>();

  for (const session of sessions) {
    totalBeers += sessionCount(session);
    totalSpentCzk += sessionTotalCzk(session);
    // Outside evenings count as beers/evenings/spend, never as a visited pub.
    if (!isContextPubKey(session.pubKey)) pubKeys.add(session.pubKey);
  }

  return {
    totalBeers,
    totalEvenings: sessions.length,
    distinctPubs: pubKeys.size,
    totalSpentCzk,
  };
}

/** Personal bests across every evening. */
export function computeRecords(sessions: TallySession[]): PersonalRecords {
  const records: PersonalRecords = {
    mostBeersInEvening: 0,
    mostBeersPubName: null,
    mostBeersStartedAt: null,
    fastestBeerMs: null,
    longestEveningMs: null,
  };

  for (const session of sessions) {
    const beers = sessionCount(session);
    if (beers > records.mostBeersInEvening) {
      records.mostBeersInEvening = beers;
      records.mostBeersPubName = session.pubName;
      records.mostBeersStartedAt = session.startedAt;
    }

    const fastest = sessionFastestGapMs(session);
    if (fastest != null && (records.fastestBeerMs == null || fastest < records.fastestBeerMs)) {
      records.fastestBeerMs = fastest;
    }

    const duration = sessionDurationMs(session);
    if (duration > 0 && (records.longestEveningMs == null || duration > records.longestEveningMs)) {
      records.longestEveningMs = duration;
    }
  }

  return records;
}

/**
 * Per-pub lifetime tallies, sorted by beer count (then most-recent). The pub's
 * display name follows its most recent evening, since a renamed pub keeps the
 * same geohash `pubKey` but may carry a newer name.
 */
export function computeTopPubs(sessions: TallySession[], limit = 8): PubTally[] {
  const byPub = new Map<string, PubTally & { lastAtMs: number }>();

  for (const session of sessions) {
    // Outside evenings ("Doma / na chatě") are not pubs — beers still count in
    // the totals elsewhere, but the top-pubs chart is a pub chart.
    if (isContextPubKey(session.pubKey)) continue;
    const beers = sessionCount(session);
    if (beers === 0) continue;
    const spent = sessionTotalCzk(session);
    const lastAtMs = sessionLastActivityMs(session);

    const existing = byPub.get(session.pubKey);
    if (!existing) {
      byPub.set(session.pubKey, {
        pubKey: session.pubKey,
        pubName: session.pubName,
        beers,
        spentCzk: spent,
        lastAt: new Date(lastAtMs).toISOString(),
        lastAtMs,
      });
      continue;
    }

    existing.beers += beers;
    existing.spentCzk += spent;
    // Keep the name + lastAt from the most recent evening at this pub.
    if (lastAtMs > existing.lastAtMs) {
      existing.lastAtMs = lastAtMs;
      existing.lastAt = new Date(lastAtMs).toISOString();
      existing.pubName = session.pubName;
    }
  }

  return [...byPub.values()]
    .sort((a, b) => (b.beers - a.beers) || (b.lastAtMs - a.lastAtMs))
    .slice(0, limit)
    .map(({ lastAtMs: _drop, ...pub }) => pub);
}
