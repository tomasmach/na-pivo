/**
 * "Čísla za celou dobu": the diary's lifetime numbers. An evening is a night,
 * one 04:00 drinking day across every pub, the same unit Deník counts. The
 * phone keeps the last 50 sittings, so the server's numbers win once they hold
 * at least as many beers; per month and year the larger count wins, as in the
 * diary's year view.
 */

import { MIN_PLAUSIBLE_BEER_GAP_MS } from '@/drinks/drinkTiming';
import { isContextPubKey } from '@/drinks/drinkTypes';
import type { RemoteStats } from '@/data/statsClient';
import type { TallySession } from '@/stores/tallyStore';

import { isBeer, nightsOf, pad2, type Night } from './eveningData';

export interface StatsRecord {
  value: number;
  /** Drinking day `YYYY-MM-DD`, when known. */
  day: string | null;
}

export interface StatsView {
  firstDay: string | null;
  beers: number;
  nights: number;
  pubs: number;
  spentCzk: number;
  /** Beers per night, one decimal. */
  average: number;
  mostBeers: (StatsRecord & { pubNames: string[] }) | null;
  fastest: (StatsRecord & { beerName: string | null }) | null;
  longest: (StatsRecord & { stops: number }) | null;
  /** The last twelve months, oldest first, ending with `now`'s month. */
  months: { period: string; beers: number; nights: number }[];
  /** Newest year first. */
  years: { year: string; beers: number }[];
  topPubs: { key: string; name: string; beers: number; nights: number | null }[];
}

const dayOf = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

function localPubs(nights: readonly Night[]) {
  const byKey = new Map<string, { key: string; name: string; beers: number; nights: number; last: number }>();
  for (const night of nights) {
    const seen = new Set<string>();
    for (const pub of night.pubs) {
      if (isContextPubKey(pub.pubKey)) continue;
      const entry = byKey.get(pub.pubKey) ?? { key: pub.pubKey, name: pub.name, beers: 0, nights: 0, last: 0 };
      entry.beers += pub.beers;
      if (!seen.has(pub.pubKey)) entry.nights += 1;
      seen.add(pub.pubKey);
      const last = Date.parse(pub.lastAt);
      if (last >= entry.last) {
        entry.last = last;
        entry.name = pub.name;
      }
      byKey.set(pub.pubKey, entry);
    }
  }
  return [...byKey.values()].sort((a, b) => b.beers - a.beers || b.last - a.last);
}

function localFastest(sessions: readonly TallySession[]) {
  let best: { ms: number; at: Date; beerName: string } | null = null;
  for (const session of sessions) {
    const beers = session.drinks.filter(isBeer).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    for (let i = 1; i < beers.length; i += 1) {
      const gap = Date.parse(beers[i].at) - Date.parse(beers[i - 1].at);
      if (!Number.isFinite(gap) || gap < MIN_PLAUSIBLE_BEER_GAP_MS) continue;
      if (!best || gap < best.ms) best = { ms: gap, at: new Date(beers[i].at), beerName: beers[i].beerName };
    }
  }
  return best;
}

function monthKeys(now: Date): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1, 12);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  });
}

export function computeStats(
  sessions: readonly TallySession[],
  remote: RemoteStats | null,
  now: Date,
  dayKey: (date: Date) => string,
): StatsView {
  const nights = nightsOf(sessions);
  const beers = nights.reduce((sum, n) => sum + n.beers, 0);
  const pubs = localPubs(nights);
  const spentCzk = nights.reduce((sum, n) => sum + n.spentCzk, 0);
  const server = remote && remote.totalBeers >= beers ? remote : null;

  const totals = server
    ? {
        beers: server.totalBeers,
        nights: Math.max(server.totalNights ?? 0, nights.length),
        pubs: Math.max(server.distinctPubs, pubs.length),
        spentCzk: server.totalSpentCzk,
      }
    : { beers, nights: nights.length, pubs: pubs.length, spentCzk };

  const oldest = nights.length ? nights.reduce((a, b) => (a.day < b.day ? a : b)).day : null;
  const serverFirst = server?.firstDrinkAt ? dayKey(new Date(server.firstDrinkAt)) : null;
  const firstDay = serverFirst && (!oldest || serverFirst < oldest) ? serverFirst : oldest;

  const localMost = nights.reduce<Night | null>((best, n) => (!best || n.beers > best.beers || (n.beers === best.beers && n.day > best.day) ? n : best), null);
  const nightRecords = server?.nightRecords;
  const mostBeers = nightRecords && nightRecords.mostBeers >= (localMost?.beers ?? 0)
    ? nightRecords.mostBeers > 0
      ? { value: nightRecords.mostBeers, day: dayOf(nightRecords.mostBeersDate), pubNames: nightRecords.mostBeersPubNames }
      : null
    : localMost && localMost.beers > 0
      ? { value: localMost.beers, day: localMost.day, pubNames: localMost.pubs.filter((p) => !isContextPubKey(p.pubKey)).map((p) => p.name) }
      : null;

  const localLongest = nights.reduce<Night | null>((best, n) => (n.endMs - n.startMs > (best ? best.endMs - best.startMs : 0) ? n : best), null);
  const longest = nightRecords && nightRecords.longestSeconds * 1000 >= (localLongest ? localLongest.endMs - localLongest.startMs : 0)
    ? nightRecords.longestSeconds > 0
      ? { value: nightRecords.longestSeconds * 1000, day: dayOf(nightRecords.longestDate), stops: nightRecords.longestPubNames.length }
      : null
    : localLongest
      ? { value: localLongest.endMs - localLongest.startMs, day: localLongest.day, stops: localLongest.pubs.filter((p) => !isContextPubKey(p.pubKey)).length }
      : null;

  const local = localFastest(sessions);
  const serverFastestMs = server?.records.fastestBeerSeconds != null && server.records.fastestBeerSeconds * 1000 >= MIN_PLAUSIBLE_BEER_GAP_MS
    ? server.records.fastestBeerSeconds * 1000
    : null;
  // The server keeps no beer name; the phone knows it when it holds the same beer.
  const fastest = serverFastestMs != null && (!local || serverFastestMs < local.ms - 999)
    ? { value: serverFastestMs, day: null, beerName: null }
    : local
      ? { value: local.ms, day: dayKey(local.at), beerName: local.beerName }
      : null;

  const months = monthKeys(now).map((period) => {
    const inMonth = nights.filter((n) => n.day.startsWith(period));
    const remoteMonth = server?.nightMonths.find((m) => m.period === period);
    return {
      period,
      beers: Math.max(inMonth.reduce((sum, n) => sum + n.beers, 0), remoteMonth?.beers ?? 0),
      nights: Math.max(inMonth.length, remoteMonth?.nights ?? 0),
    };
  });

  const yearBeers = new Map<string, number>();
  for (const n of nights) yearBeers.set(n.day.slice(0, 4), (yearBeers.get(n.day.slice(0, 4)) ?? 0) + n.beers);
  for (const y of server?.periods.years ?? []) yearBeers.set(y.period, Math.max(yearBeers.get(y.period) ?? 0, y.beers));
  const years = [...yearBeers.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, n]) => ({ year, beers: n }));

  const localByKey = new Map(pubs.map((p) => [p.key, p]));
  const topPubs = server && server.topPubs.length > 0
    ? server.topPubs.map((p) => ({ key: p.cacheKey, name: p.name, beers: p.beers, nights: p.evenings ?? localByKey.get(p.cacheKey)?.nights ?? null }))
    : pubs.map((p) => ({ key: p.key, name: p.name, beers: p.beers, nights: p.nights }));

  return {
    firstDay,
    ...totals,
    average: totals.nights > 0 ? Math.round((totals.beers / totals.nights) * 10) / 10 : 0,
    mostBeers,
    fastest,
    longest,
    months,
    years,
    topPubs,
  };
}
