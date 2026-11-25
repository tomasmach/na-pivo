import type { RemoteStats } from '@/data/statsClient';
import { drinkingDayKey, type TallySession } from '@/stores/tallyStore';

import { computeStats } from '../statsData';

function local(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function session(clientId: string, pubKey: string, pubName: string, drinks: [string, string, number?, string?][]): TallySession {
  return {
    clientId,
    pubKey,
    pubName,
    startedAt: drinks[0][0],
    drinks: drinks.map(([at, beerName, priceCzk, drinkType], i) => ({
      id: `${clientId}-${i}`,
      at,
      beerName,
      ...(priceCzk ? { priceCzk } : {}),
      ...(drinkType ? { drinkType: drinkType as 'soft_drink' } : {}),
    })),
  };
}

const lokal = session('a', 'u2fkbn12', 'Lokál Dlouhá', [
  [local(2026, 10, 24, 19, 10), 'Pilsner Urquell', 59],
  [local(2026, 10, 24, 20, 5), 'Pilsner Urquell', 59],
  [local(2026, 10, 24, 20, 30), 'Kofola', 42, 'soft_drink'],
]);
// After midnight, before the 04:00 cutoff: still Saturday's night.
const pinkas = session('b', 'u2fkbn34', 'U Pinkasů', [
  [local(2026, 10, 24, 22, 15), 'Kozel 11°', 52],
  [local(2026, 10, 25, 0, 40), 'Kozel 11°', 52],
]);
const wednesday = session('c', 'u2fkbn12', 'Lokál Dlouhá', [[local(2026, 10, 21, 20, 0), 'Pilsner Urquell']]);
const now = new Date(2026, 10, 4, 12);

function remote(over: Partial<RemoteStats> = {}): RemoteStats {
  return {
    totalBeers: 142,
    totalEvenings: 70,
    totalNights: 61,
    distinctPubs: 38,
    totalSpentCzk: 9870,
    firstDrinkAt: local(2025, 6, 3, 19),
    topPubs: [
      { cacheKey: 'u2fkbn99', name: 'U Zlatého tygra', beers: 31, spentCzk: 1800, lastDrankAt: local(2026, 10, 1, 21), evenings: 12 },
      { cacheKey: 'u2fkbn12', name: 'Lokál Dlouhá', beers: 24, spentCzk: 1400, lastDrankAt: local(2026, 10, 24, 20), evenings: null },
    ],
    records: { mostBeersInEvening: 9, mostBeersPubName: 'U Zlatého tygra', mostBeersDate: '2026-02-14', fastestBeerSeconds: 360, longestEveningSeconds: 20400 },
    nightRecords: { mostBeers: 9, mostBeersDate: '2026-02-14', mostBeersPubNames: ['U Zlatého tygra'], longestSeconds: 20400, longestDate: '2025-09-19', longestPubNames: ['A', 'B', 'C'] },
    nightMonths: [{ period: '2026-10', beers: 22, nights: 6 }],
    periods: {
      timezone: 'Europe/Prague',
      months: [],
      years: [
        { period: '2025', beers: 41, evenings: 20, spentCzk: 0, averageBeersPerEvening: 2 },
        { period: '2026', beers: 101, evenings: 50, spentCzk: 0, averageBeersPerEvening: 2 },
      ],
    },
    ...over,
  };
}

it('counts nights like the diary when only the phone knows the beers', () => {
  const stats = computeStats([pinkas, lokal, wednesday], null, now, drinkingDayKey);

  expect(stats).toMatchObject({ beers: 5, nights: 2, pubs: 2, spentCzk: 264, average: 2.5, firstDay: '2026-10-21' });
  expect(stats.mostBeers).toEqual({ value: 4, day: '2026-10-24', pubNames: ['Lokál Dlouhá', 'U Pinkasů'] });
  expect(stats.fastest).toEqual({ value: 55 * 60_000, day: '2026-10-24', beerName: 'Pilsner Urquell' });
  expect(stats.longest).toEqual({ value: 330 * 60_000, day: '2026-10-24', stops: 2 });
  expect(stats.months).toHaveLength(12);
  expect(stats.months[0].period).toBe('2025-12');
  expect(stats.months[10]).toEqual({ period: '2026-10', beers: 5, nights: 2 });
  expect(stats.years).toEqual([{ year: '2026', beers: 5 }]);
  expect(stats.topPubs).toEqual([
    { key: 'u2fkbn12', name: 'Lokál Dlouhá', beers: 3, nights: 2 },
    { key: 'u2fkbn34', name: 'U Pinkasů', beers: 2, nights: 1 },
  ]);
});

it('takes the lifetime numbers from the server once it knows at least as many beers', () => {
  const stats = computeStats([pinkas, lokal, wednesday], remote(), now, drinkingDayKey);

  expect(stats).toMatchObject({ beers: 142, nights: 61, pubs: 38, spentCzk: 9870, average: 2.3, firstDay: '2025-06-03' });
  expect(stats.mostBeers).toEqual({ value: 9, day: '2026-02-14', pubNames: ['U Zlatého tygra'] });
  // The server keeps no beer name for its faster beer.
  expect(stats.fastest).toEqual({ value: 6 * 60_000, day: null, beerName: null });
  expect(stats.longest).toEqual({ value: 20_400_000, day: '2025-09-19', stops: 3 });
  expect(stats.months[10]).toEqual({ period: '2026-10', beers: 22, nights: 6 });
  expect(stats.years).toEqual([
    { year: '2026', beers: 101 },
    { year: '2025', beers: 41 },
  ]);
  // A server without per-pub evenings falls back to the nights the phone knows.
  expect(stats.topPubs.map((p) => [p.name, p.nights])).toEqual([
    ['U Zlatého tygra', 12],
    ['Lokál Dlouhá', 2],
  ]);
});

it('keeps the phone numbers when the server has not seen the newest beers yet', () => {
  const stats = computeStats([pinkas, lokal, wednesday], remote({ totalBeers: 3 }), now, drinkingDayKey);

  expect(stats).toMatchObject({ beers: 5, nights: 2, spentCzk: 264 });
});

it('reads an older server without night fields from the phone', () => {
  const stats = computeStats([pinkas, lokal, wednesday], remote({ totalNights: null, nightRecords: null, nightMonths: [] }), now, drinkingDayKey);

  expect(stats.nights).toBe(2);
  expect(stats.mostBeers?.value).toBe(4);
  expect(stats.months[10]).toEqual({ period: '2026-10', beers: 5, nights: 2 });
});

it('is empty without any beer', () => {
  expect(computeStats([], null, now, drinkingDayKey)).toMatchObject({ beers: 0, nights: 0, mostBeers: null, fastest: null, longest: null, topPubs: [] });
});
