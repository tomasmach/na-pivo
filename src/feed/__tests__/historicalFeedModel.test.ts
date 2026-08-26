import type { PublishedNight } from '@/data/nightsClient';
import type { PartaFeedSitting } from '@/data/partaFeedClient';

import { mergeHistoricalNights, withoutRunningNight } from '../historicalFeedModel';

function sitting(
  id: string,
  overrides: Partial<PartaFeedSitting> = {},
): PartaFeedSitting {
  return {
    id,
    account: {
      id: 'friend-1',
      nickname: 'jarek',
      displayName: 'Jarek',
      avatarUrl: null,
      isPublic: true,
    },
    mine: false,
    placeContext: 'pub',
    pubName: 'Cisterna',
    pubCity: 'Trutnov',
    cacheKey: 'u2fkbfvz',
    lat: null,
    lng: null,
    startedAt: '2026-07-18T18:00:00.000Z',
    endedAt: '2026-07-18T20:00:00.000Z',
    total: 3,
    items: [
      {
        drinkType: 'beer',
        servingType: 'draft',
        name: 'Pilsner Urquell',
        count: 3,
      },
    ],
    ...overrides,
  };
}

function publishedNight(): PublishedNight {
  return {
    id: 'published-1',
    author: sitting('source').account,
    drinkingDay: '2026-07-18',
    startedAt: '2026-07-18T18:00:00.000Z',
    endedAt: '2026-07-18T23:00:00.000Z',
    beerCount: 5,
    wineCount: 0,
    softDrinkCount: 0,
    shotCount: 0,
    pubNames: ['Cisterna'],
    city: 'Trutnov',
    durationMinutes: 300,
    title: '',
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    visibility: 'friends',
    createdAt: '2026-07-18T23:05:00.000Z',
    rounds: 0,
    myRound: false,
    isMine: false,
    commentCount: 0,
  };
}

it('adds pre-3.0 sittings to Parta and folds a crawl into one historical night', () => {
  const result = mergeHistoricalNights([], [
    sitting('first'),
    sitting('second', {
      pubName: 'Na Pile',
      cacheKey: 'u2fkbn1z',
      startedAt: '2026-07-18T21:00:00.000Z',
      endedAt: '2026-07-19T01:30:00.000Z',
      total: 2,
      items: [
        { drinkType: 'shot', servingType: 'unknown', name: 'Fernet', count: 1 },
        { drinkType: 'soft_drink', servingType: 'unknown', name: 'Kofola', count: 1 },
      ],
    }),
  ]);

  expect(result).toEqual([
    expect.objectContaining({
      id: 'historical-night:friend-1:2026-07-18',
      historical: true,
      beerCount: 3,
      shotCount: 1,
      softDrinkCount: 1,
      pubNames: ['Cisterna', 'Na Pile'],
      durationMinutes: 450,
    }),
  ]);
});

it('keeps the explicitly published version instead of duplicating its historical day', () => {
  const published = publishedNight();

  expect(mergeHistoricalNights([published], [sitting('legacy')])).toEqual([
    published,
  ]);
});


describe('withoutRunningNight', () => {
  const automatic = (over: Partial<PublishedNight> = {}): PublishedNight => ({
    ...publishedNight(),
    id: 'historical-night:me:2026-07-18',
    historical: true,
    isMine: true,
    drinkingDay: '2026-07-18',
    ...over,
  });

  it('hides my own automatic card for the evening that is still running', () => {
    const nights = [automatic(), automatic({ id: 'other-day', drinkingDay: '2026-07-17' })];

    expect(withoutRunningNight(nights, '2026-07-18').map((night) => night.id)).toEqual([
      'other-day',
    ]);
  });

  it("keeps a published night, a friend's card and everything when nothing runs", () => {
    const nights = [
      automatic({ id: 'published', historical: false }),
      automatic({ id: 'friend', isMine: false }),
    ];

    expect(withoutRunningNight(nights, '2026-07-18').map((night) => night.id)).toEqual([
      'published',
      'friend',
    ]);
    expect(withoutRunningNight([automatic()], null)).toHaveLength(1);
  });
});
