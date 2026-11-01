import type { TallySession } from '@/stores/tallyStore';

import { beerTally, distinctBeerCount, hasBeerBefore, hourlyTempo, nightOrdinal, nightsOf, previousNight } from '../eveningData';

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

it('groups every sitting of one drinking day into a night across pubs', () => {
  const nights = nightsOf([pinkas, lokal, wednesday]);

  expect(nights.map((n) => n.day)).toEqual(['2026-10-24', '2026-10-21']);
  const saturday = nights[0];
  expect(saturday.beers).toBe(4);
  expect(saturday.spentCzk).toBe(59 + 59 + 42 + 52 + 52);
  expect(saturday.pubs.map((p) => [p.name, p.beers])).toEqual([
    ['Lokál Dlouhá', 2],
    ['U Pinkasů', 2],
  ]);
  expect(nights[1].priced).toBe(false);
});

it('numbers nights and finds the previous one for the receipt', () => {
  const nights = nightsOf([pinkas, lokal, wednesday]);

  expect(nightOrdinal(nights, '2026-10-24')).toBe(2);
  expect(previousNight(nights, '2026-10-24')?.day).toBe('2026-10-21');
  expect(previousNight(nights, '2026-10-21')).toBeNull();
});

it('counts beers per hour from the first to the last beer', () => {
  const [saturday] = nightsOf([pinkas, lokal]);

  const tempo = hourlyTempo(saturday);
  expect(tempo[0]).toEqual({ hour: 19, count: 1 });
  expect(tempo.find((h) => h.hour === 22)?.count).toBe(1);
  expect(tempo[tempo.length - 1]).toEqual({ hour: 0, count: 1 });
});

it('ranks beers by how often they were logged and spots a first-time beer', () => {
  const sessions = [pinkas, lokal, wednesday];

  expect(beerTally(sessions).map((b) => [b.name, b.count])).toEqual([
    ['Pilsner Urquell', 3],
    ['Kozel 11°', 2],
  ]);
  expect(distinctBeerCount(sessions)).toBe(2);
  expect(hasBeerBefore(sessions, 'kozel 11°', 'b-0')).toBe(true);
  expect(hasBeerBefore([pinkas], 'Kozel 11°', 'b-0')).toBe(true);
  expect(hasBeerBefore([lokal], 'Bernard 11°', 'x')).toBe(false);
});
