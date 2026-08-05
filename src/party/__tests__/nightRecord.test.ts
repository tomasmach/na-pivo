/**
 * The night as data (src/party/nightRecord.ts).
 *
 * These are the numbers the hub, the recap and the feed post all print, so a
 * wrong one here is wrong in three places at once and in a post somebody else
 * reads. Every rule tested below is a product decision, not arithmetic:
 * what counts as a beer, what a tie means, and what a night is allowed to
 * claim about itself.
 */

import {
  emptyNight,
  nightBrokenRecords,
  nightByBeer,
  nightHourly,
  nightMinutes,
  nightMvp,
  nightPerHour,
  nightPlayedGames,
  nightStandings,
  nightStops,
  nightThread,
  nightTally,
  type NightDrink,
  type NightRecord,
} from '@/party/nightRecord';

/** 30 July 2026, 20:00 local — the hour labels below are local hours. */
const START = new Date(2026, 6, 30, 20, 0).toISOString();
const at = (hour: number, minute = 0) =>
  new Date(2026, 6, 30, hour, minute).toISOString();
const NOW = new Date(2026, 6, 31, 2, 0).getTime();

const PEOPLE = [
  { id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
  { id: 'h', name: 'Honza', avatarUrl: null, tint: '#7DD66B' },
];

let seq = 0;
function drink(by: string, hour: number, over: Partial<NightDrink> = {}): NightDrink {
  seq += 1;
  return {
    id: `d${seq}`,
    at: at(hour),
    by,
    beerName: 'Plzeň',
    drinkType: 'beer',
    stopId: null,
    ...over,
  };
}

function night(over: Partial<NightRecord> = {}): NightRecord {
  return { ...emptyNight('n1', START, 'STUL24'), people: PEOPLE, ...over };
}

beforeEach(() => {
  seq = 0;
});

describe('nightTally', () => {
  it('counts a radler as a beer only if it was logged as one', () => {
    const record = night({
      drinks: [
        drink('me', 20),
        drink('me', 21, { drinkType: 'soft_drink', beerName: 'Kofola' }),
        drink('h', 21, { drinkType: 'shot', beerName: 'Slivovice' }),
        drink('h', 22, { drinkType: 'wine', beerName: 'Ryzlink' }),
      ],
    });

    expect(nightTally(record)).toEqual({ beers: 1, softDrinks: 1, shots: 1, wine: 1 });
  });
});

describe('nightStandings', () => {
  it('keeps somebody who has had nothing on the list', () => {
    // A person who joined and is missing from the board reads as a bug.
    const record = night({ drinks: [drink('me', 20)] });
    const standings = nightStandings(record);

    expect(standings.map((row) => [row.name, row.beers])).toEqual([
      ['Ty', 1],
      ['Honza', 0],
    ]);
  });

  it('ranks by beers, not by everything in the glass', () => {
    const record = night({
      drinks: [
        drink('h', 20),
        drink('h', 21),
        drink('me', 20),
        drink('me', 21, { drinkType: 'soft_drink', beerName: 'Kofola' }),
        drink('me', 22, { drinkType: 'shot', beerName: 'Fernet' }),
      ],
    });
    const standings = nightStandings(record);

    expect(standings[0].name).toBe('Honza');
    expect(standings[1].tally).toEqual({ beers: 1, softDrinks: 1, shots: 1, wine: 0 });
  });
});

describe('nightMvp', () => {
  it('crowns the clear top', () => {
    const record = night({ drinks: [drink('h', 20), drink('h', 21), drink('me', 20)] });

    expect(nightMvp(nightStandings(record))?.name).toBe('Honza');
  });

  it('leaves a shared top alone', () => {
    const record = night({ drinks: [drink('h', 20), drink('me', 20)] });

    expect(nightMvp(nightStandings(record))).toBeNull();
  });

  it('crowns nobody when nobody has had a beer', () => {
    const record = night({ drinks: [drink('me', 20, { drinkType: 'soft_drink' })] });

    expect(nightMvp(nightStandings(record))).toBeNull();
  });
});

describe('nightHourly', () => {
  it('keeps an empty hour in the middle', () => {
    // Two hours where nothing happened IS the shape of the night. Dropping
    // them would draw it as steady.
    const record = night({ drinks: [drink('me', 20), drink('me', 20, {}), drink('h', 23)] });

    expect(nightHourly(record)).toEqual([
      { hour: '20', beers: 2 },
      { hour: '21', beers: 0 },
      { hour: '22', beers: 0 },
      { hour: '23', beers: 1 },
    ]);
  });

  it('has no shape before the first beer', () => {
    expect(nightHourly(night())).toEqual([]);
  });

  it('leaves soft drinks out of the tempo', () => {
    const record = night({
      drinks: [drink('me', 20), drink('me', 21, { drinkType: 'soft_drink' })],
    });

    expect(nightHourly(record)).toEqual([{ hour: '20', beers: 1 }]);
  });
});

describe('nightByBeer', () => {
  it('groups the same beer however it was typed, and shows it as first written', () => {
    const record = night({
      drinks: [
        drink('me', 20, { beerName: 'Plzeň' }),
        drink('h', 21, { beerName: 'plzeň' }),
        drink('h', 22, { beerName: 'Kozel' }),
      ],
    });

    expect(nightByBeer(record)).toEqual([
      { beer: 'Plzeň', count: 2 },
      { beer: 'Kozel', count: 1 },
    ]);
  });
});

describe('nightStops', () => {
  it('puts each beer at the pub it was drunk in, and times the stay', () => {
    const record = night({
      stops: [
        { id: 's2', pubName: 'Zlý časy', cacheKey: 'b', arrivedAt: at(22) },
        { id: 's1', pubName: 'U Fleků', cacheKey: 'a', arrivedAt: at(20) },
      ],
      drinks: [drink('me', 20, { stopId: 's1' }), drink('h', 22, { stopId: 's2' })],
    });
    const stops = nightStops(record, NOW);

    expect(stops.map((stop) => [stop.pubName, stop.beers, stop.minutes])).toEqual([
      ['U Fleků', 1, 120],
      // Still there: the last stop runs to the end of the night.
      ['Zlý časy', 1, 240],
    ]);
  });
});

describe('nightMinutes', () => {
  it('measures a running night to now and a finished one to its end', () => {
    expect(nightMinutes(night(), NOW)).toBe(360);
    expect(nightMinutes(night({ endedAt: at(23) }), NOW)).toBe(180);
  });
});

describe('nightPerHour', () => {
  it('says nothing about pace in the first twenty minutes', () => {
    const early = new Date(2026, 6, 30, 20, 10).getTime();

    expect(nightPerHour(night({ drinks: [drink('me', 20)] }), early)).toBeNull();
  });

  it('is beers over hours once there is enough night to divide by', () => {
    const record = night({ drinks: [drink('me', 20), drink('me', 21), drink('me', 22)] });

    expect(nightPerHour(record, new Date(2026, 6, 30, 23, 0).getTime())).toBe(1);
  });
});

describe('nightBrokenRecords', () => {
  const record = night({
    endedAt: at(23),
    stops: [
      { id: 's1', pubName: 'U Fleků', cacheKey: 'a', arrivedAt: at(20) },
      { id: 's2', pubName: 'Zlý časy', cacheKey: 'b', arrivedAt: at(22) },
    ],
    drinks: [drink('me', 20), drink('me', 21)],
  });

  it('announces only what tonight actually beat', () => {
    const broken = nightBrokenRecords(record, { beers: 1, minutes: 999, stops: 5 }, NOW);

    expect(broken).toEqual([{ kind: 'beers', value: 2, previous: 1 }]);
  });

  it('does not call equalling a record breaking it', () => {
    // Matching last Tuesday is not a record, and saying so cheapens the real ones.
    expect(nightBrokenRecords(record, { beers: 2, minutes: 180, stops: 2 }, NOW)).toEqual([]);
  });
});

describe('nightPlayedGames', () => {
  it('leaves out a game that is still on the table', () => {
    const record = night({
      games: [
        { key: 'dice', name: 'Kostky', startedAt: at(21) },
        {
          key: 'quiz',
          name: 'Pub kvíz',
          startedAt: at(22),
          result: { winner: 'Honza', scores: [{ name: 'Honza', score: 3 }] },
        },
      ],
    });

    expect(nightPlayedGames(record).map((game) => game.key)).toEqual(['quiz']);
  });
});

describe('nightThread', () => {
  const record = night({
    people: [
      { ...PEOPLE[0], joinedAt: at(20) },
      { ...PEOPLE[1], joinedAt: at(21) },
    ],
    stops: [{ id: 's1', pubName: 'U Fleků', cacheKey: 'a', arrivedAt: at(20) }],
    drinks: [drink('me', 20, { stopId: 's1' }), drink('h', 22), drink('me', 23)],
    photos: [{ id: 'ph1', url: 'file://a.jpg', at: at(22, 30), by: 'h' }],
    games: [{ key: 'dice', name: 'Kostky', startedAt: at(21, 30) }],
  });

  it('puts everything that happened in one list, in order', () => {
    expect(nightThread(record).map((entry) => entry.kind)).toEqual([
      'join',
      'pub',
      'beer',
      'join',
      'game',
      'beer',
      'photo',
      'beer',
    ]);
  });

  it('names who did it, because at a table of four an unsigned row is the app talking to itself', () => {
    const photo = nightThread(record).find((entry) => entry.kind === 'photo');

    expect(photo?.by).toBe('h');
    expect(photo?.url).toBe('file://a.jpg');
  });

  it('counts your beers, not the table\'s', () => {
    // Mine are 1 and 2 even though Honza's landed between them.
    const beers = nightThread(record).filter((entry) => entry.kind === 'beer');

    expect(beers.map((entry) => [entry.by, entry.ordinal])).toEqual([
      ['me', 1],
      ['h', 1],
      ['me', 2],
    ]);
  });

  it('leaves a game unsigned — the row leads with the game', () => {
    const game = nightThread(record).find((entry) => entry.kind === 'game');

    expect(game?.by).toBeNull();
    expect(game?.gameKey).toBe('dice');
  });

  it('has nothing to show for a night that has not started', () => {
    expect(nightThread(night())).toEqual([]);
  });
});
