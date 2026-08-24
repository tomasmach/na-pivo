import {
  emptyNight,
  nightBrokenRecords,
  nightMinutes,
  type NightRecord,
} from '@/party/nightRecord';
import {
  mergeConfirmedNightBest,
  personalNightRecord,
} from '@/party/personalNightRecord';

const at = (hour: number) => new Date(2026, 7, 5, hour, 0).toISOString();

function sharedNight(): NightRecord {
  return {
    ...emptyNight('party-1', at(18), 'PIVOXY'),
    endedAt: at(2),
    people: [
      {
        id: 'me',
        name: 'Ty',
        avatarUrl: null,
        tint: '#E8A317',
        joinedAt: at(20),
        leftAt: at(23),
      },
      { id: 'friend', name: 'Honza', avatarUrl: null, tint: '#7DD66B' },
    ],
    stops: [
      { id: 'mine-1', by: 'me', pubName: 'U Fleků', cacheKey: 'u-fleku', arrivedAt: at(20) },
      { id: 'his-1', by: 'friend', pubName: 'U Fleků', cacheKey: 'u-fleku', arrivedAt: at(20) },
      { id: 'mine-2', by: 'me', pubName: 'Lokál', cacheKey: 'lokal', arrivedAt: at(22) },
      { id: 'his-2', by: 'friend', pubName: 'Lokál', cacheKey: 'lokal', arrivedAt: at(22) },
      { id: 'his-3', by: 'friend', pubName: 'Tiskárna', cacheKey: 'tiskarna', arrivedAt: at(23) },
    ],
    drinks: [
      { id: 'my-1', at: at(20), by: 'me', beerName: 'Plzeň', drinkType: 'beer', stopId: 'mine-1' },
      { id: 'my-2', at: at(23), by: 'me', beerName: 'Kozel', drinkType: 'beer', stopId: 'mine-2' },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `his-${index}`,
        at: at(20 + (index % 4)),
        by: 'friend',
        beerName: 'Radegast',
        drinkType: 'beer' as const,
        stopId: index < 4 ? 'his-1' : index < 7 ? 'his-2' : 'his-3',
      })),
    ],
  };
}

describe('personalNightRecord', () => {
  it('merges durable whole-history bests with unsynced local history', () => {
    expect(
      mergeConfirmedNightBest(
        { beers: 4, minutes: 300, stops: 2 },
        { mostBeers: 7, longestSeconds: 14_400, mostStops: 3 },
      ),
    ).toEqual({ beers: 7, minutes: 300, stops: 3 });
  });

  it('projects only the current account drinks, stops, and membership span', () => {
    const personal = personalNightRecord(sharedNight(), 'me');

    expect(personal?.drinks.map((drink) => drink.id)).toEqual(['my-1', 'my-2']);
    expect(personal?.stops.map((stop) => stop.id)).toEqual(['mine-1', 'mine-2']);
    expect(personal?.startedAt).toBe(at(20));
    expect(personal?.endedAt).toBe(at(23));
    expect(nightMinutes(personal!, Date.now())).toBe(180);
  });

  it('uses the current account leave time instead of the whole table end', () => {
    const night = sharedNight();
    night.endedAt = new Date(2026, 7, 6, 2, 0).toISOString();
    night.drinks = night.drinks.filter((drink) => drink.id !== 'my-2');

    const personal = personalNightRecord(night, 'me');

    expect(personal?.endedAt).toBe(at(23));
    expect(nightMinutes(personal!, Date.now())).toBe(180);
  });

  it('does not turn the rest of the table into a personal record', () => {
    const personal = personalNightRecord(sharedNight(), 'me');

    expect(
      personal &&
        nightBrokenRecords(personal, { beers: 2, minutes: 180, stops: 2 }, Date.now()),
    ).toEqual([]);
  });

  it('keeps a legacy ownerless stop only when a personal drink references it', () => {
    const night = sharedNight();
    night.stops = [
      { id: 'own-ref', pubName: 'U Fleků', cacheKey: 'u-fleku', arrivedAt: at(20) },
      { id: 'foreign', pubName: 'Lokál', cacheKey: 'lokal', arrivedAt: at(21) },
    ];
    night.drinks = [
      { ...night.drinks[0], stopId: 'own-ref' },
      ...night.drinks.filter((drink) => drink.by === 'friend'),
    ];

    expect(personalNightRecord(night, 'me')?.stops.map((stop) => stop.id)).toEqual(['own-ref']);
  });
});
