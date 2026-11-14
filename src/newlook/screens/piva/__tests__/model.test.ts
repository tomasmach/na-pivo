import type { BeerCheckIn, BeerCheckInInput } from '@/data/beerCheckinsClient';

const queued: { op: string; payload: BeerCheckInInput }[] = [];
let pending: BeerCheckInInput[] = [];

jest.mock('expo-location', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/notifications/friendPush', () => ({ requestPushRegistration: jest.fn() }));
jest.mock('@/beerWatch/beerWatchLocation', () => ({ syncBeerWatchLocation: jest.fn() }));
jest.mock('@/stores/beerWatchStore', () => ({ useBeerWatchStore: { getState: jest.fn() }, findBeerWatch: jest.fn() }));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: { getState: () => ({ session: { accountId: 'me' } }) } }));
jest.mock('@/data/beerCheckinsQueue', () => ({
  enqueueBeerCheckInOp: jest.fn(async (item: { op: string; payload: BeerCheckInInput }) => {
    queued.push(item);
  }),
  getPendingBeerCheckIns: jest.fn(async () => pending),
}));
let serverHistory: BeerCheckIn[] | null = [];
jest.mock('@/data/beerCheckinsClient', () => ({ fetchMyBeerCheckIns: jest.fn(async () => serverHistory) }));

// eslint-disable-next-line import/first -- the mocks above must exist before the module loads
import { loadMyRatedBeers, loadMyRatings, myRating, reviewDay, saveBeerRating, savedRating } from '../model';

function checkIn(overrides: Partial<BeerCheckIn> = {}): BeerCheckIn {
  return {
    id: 'srv-1',
    account: { id: 'me', nickname: null, displayName: 'Já', avatarUrl: null, isPublic: false },
    clientId: 'old-client-id',
    beerName: 'Pilsner Urquell',
    breweryName: 'Plzeňský Prazdroj',
    beerStyle: 'ležák',
    abv: 4.4,
    quantity: 2,
    priceCzk: 62,
    rating: 3,
    note: 'Starý zápis',
    tags: ['crisp'],
    pubCacheKey: 'u2fkbn1z',
    pubName: 'U Zlatého tygra',
    pubCity: 'Praha',
    visitClientId: null,
    visibility: 'friends',
    checkedInAt: '2026-01-10T20:00:00.000Z',
    endedAt: null,
    reactions: { cheers: 0 },
    myReaction: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  queued.length = 0;
  pending = [];
});

it('rewrites my latest check-in of the beer and keeps its diary fields', async () => {
  const payload = await saveBeerRating({ beerName: 'Pilsner Urquell', history: [checkIn()] }, { rating: 5 });
  expect(queued).toHaveLength(1);
  expect(payload).toMatchObject({
    clientId: 'old-client-id',
    rating: 5,
    quantity: 2,
    priceCzk: 62,
    pubName: 'U Zlatého tygra',
    note: 'Starý zápis',
    visibility: 'friends',
    checkedInAt: '2026-01-10T20:00:00.000Z',
  });
  expect(savedRating('pilsner urquell')).toBe(5);
});

it('adds one private check-in for a beer I never checked in, and reuses it on the next rating', async () => {
  const first = await saveBeerRating({ beerName: 'Kozel Černý', history: [] }, { rating: 4 });
  expect(first.clientId).not.toBe('old-client-id');
  expect(first.visibility).toBe('private');
  const second = await saveBeerRating({ beerName: 'Kozel Černý', history: [] }, { rating: 2, visibility: 'public' });
  expect(second.clientId).toBe(first.clientId);
  expect(second).toMatchObject({ rating: 2, visibility: 'public' });
});

it('prefers a still queued check-in so offline ratings never duplicate', async () => {
  pending = [{ clientId: 'queued-id', beerName: 'Bernard 12', visibility: 'private', rating: 3 }];
  const payload = await saveBeerRating({ beerName: 'bernard 12', history: [checkIn({ beerName: 'Bernard 12' })] }, { rating: 4 });
  expect(payload.clientId).toBe('queued-id');
});

it('starts a new check-in for a visit at another pub', async () => {
  const payload = await saveBeerRating(
    { beerName: 'Svijanský Rytíř', history: [checkIn({ beerName: 'Svijanský Rytíř' })], pub: { name: 'Lokál', cacheKey: 'abc' } },
    { rating: 4, note: 'Na čepu fajn' },
  );
  expect(payload.clientId).not.toBe('old-client-id');
  expect(payload).toMatchObject({ pubName: 'Lokál', pubCacheKey: 'abc', note: 'Na čepu fajn' });
  expect(payload.quantity).toBeUndefined();
});

it('says the review day, never the hour', () => {
  const now = new Date(2026, 10, 1, 12);
  expect(reviewDay('2026-11-01', now)).toBe('dnes');
  expect(reviewDay('2026-10-31', now)).toBe('včera');
  expect(reviewDay('2026-10-29', now)).toBe('před 3 dny');
  expect(reviewDay('2026-10-22', now)).toBe('minulý týden');
});

describe('loadMyRatings', () => {
  it('takes my newest rated check-in per beer, lets the offline queue win and keeps the server stars offline', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-02T20:00:00Z') });
    serverHistory = [
      checkIn({ beerName: 'Kozel 11°', rating: 4 }),
      checkIn({ beerName: 'Kozel 11°', rating: 2 }),
      checkIn({ beerName: 'Bernard 11°', rating: null }),
      checkIn({ beerName: 'Matuška Raptor', rating: 5 }),
    ];
    pending = [{ ...checkIn({ beerName: 'Matuška Raptor', rating: 3 }), clientId: 'queued' } as BeerCheckInInput];

    const online = await loadMyRatings();
    expect(myRating(online, 'kozel 11°')).toBe(4);
    expect(myRating(online, 'Bernard 11°')).toBeNull();
    expect(myRating(online, 'Matuška Raptor')).toBe(3);

    serverHistory = null;
    pending = [];
    jest.setSystemTime(new Date('2026-11-02T20:05:00Z'));
    const offline = await loadMyRatings();
    expect(myRating(offline, 'Kozel 11°')).toBe(4);
    jest.useRealTimers();
  });

  it('after a restart offline shows the stars stored last time and skips malformed values', async () => {
    serverHistory = null;
    pending = [];
    let storage!: { setItem: (key: string, value: string) => Promise<void> };
    let fresh!: typeof import('../model');
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      storage = require('@react-native-async-storage/async-storage');
      fresh = require('../model');
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
    await storage.setItem('nv-my-ratings:me', JSON.stringify({ 'kozel 11': 4, rotten: 'x', 'too much': 9 }));

    const ratings = await fresh.loadMyRatings();

    expect(fresh.myRating(ratings, 'Kozel 11°')).toBe(4);
    expect(fresh.myRating(ratings, 'rotten')).toBeNull();
    expect(fresh.myRating(ratings, 'too much')).toBeNull();
  });
});

describe('loadMyRatedBeers', () => {
  it('lists every beer once with my newest stars, lets a queued rating win and sorts the best first', async () => {
    serverHistory = [
      checkIn({ beerName: 'Únětická 12', breweryName: 'Únětický pivovar', productKey: 'uneticka-12', rating: 4, updatedAt: '2026-03-01T20:00:00.000Z' }),
      checkIn({ beerName: 'únětická  12', rating: 2, updatedAt: '2026-01-01T20:00:00.000Z' }),
      checkIn({ beerName: 'Chodovar 11', breweryName: 'Chodovar', productKey: null, rating: 4, updatedAt: '2026-04-01T20:00:00.000Z' }),
      checkIn({ beerName: 'Bez hvězd', rating: null }),
      checkIn({ beerName: 'Rychtář 12', breweryName: 'Rychtář', productKey: 'rychtar-12', rating: 3 }),
    ];
    pending = [{ clientId: 'q', beerName: 'Rychtář 12', rating: 5, visibility: 'private' }];

    const mine = new Set(['Únětická 12', 'Chodovar 11', 'Rychtář 12', 'Bez hvězd']);
    const beers = (await loadMyRatedBeers())?.filter((b) => mine.has(b.beerName));

    expect(beers?.map((b) => [b.beerName, b.rating, b.productKey])).toEqual([
      ['Rychtář 12', 5, 'rychtar-12'],
      ['Chodovar 11', 4, null],
      ['Únětická 12', 4, 'uneticka-12'],
    ]);
    expect(beers?.[0].breweryName).toBe('Rychtář');
  });

  it('says it failed instead of showing an empty list when the server does not answer', async () => {
    serverHistory = null;
    expect(await loadMyRatedBeers()).toBeNull();
  });
});
