import type { BeerCheckIn, BeerCheckInInput } from '@/data/beerCheckinsClient';

const queued: { op: string; payload: BeerCheckInInput }[] = [];
let pending: BeerCheckInInput[] = [];

jest.mock('expo-location', () => ({}));
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

// eslint-disable-next-line import/first -- the mocks above must exist before the module loads
import { reviewDay, saveBeerRating, savedRating } from '../model';

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
