import {
  deriveReconciledDiaryStats,
  reconcileDiarySnapshot,
  type DiarySnapshot,
} from '../diarySync';
import { fetchDrinks } from '../drinksClient';
import { flushDrinksQueue } from '../drinksQueue';
import { flushDeleteDrinksQueue } from '../deleteDrinksQueue';
import { flushUpdateDrinksQueue } from '../updateDrinksQueue';
import { fetchVisits } from '../visitsClient';
import { flushVisitsQueue } from '../visitsQueue';
import type { TallySession } from '@/stores/tallyStore';

jest.mock('../drinksClient', () => ({ fetchDrinks: jest.fn() }));
jest.mock('../visitsClient', () => ({ fetchVisits: jest.fn() }));
jest.mock('../drinksQueue', () => ({ flushDrinksQueue: jest.fn(async () => undefined) }));
jest.mock('../deleteDrinksQueue', () => ({ flushDeleteDrinksQueue: jest.fn(async () => undefined) }));
jest.mock('../updateDrinksQueue', () => ({ flushUpdateDrinksQueue: jest.fn(async () => undefined) }));
jest.mock('../visitsQueue', () => ({ flushVisitsQueue: jest.fn(async () => undefined) }));

const PUB_A = 'u2fkbn0x';
const PUB_B = 'u2fkbn1y';

function remoteDrink(clientId: string, cacheKey: string | null, price = 60) {
  return {
    client_id: clientId,
    cache_key: cacheKey,
    name: cacheKey ? 'Hospoda' : '',
    lat: cacheKey ? 50 : null,
    lng: cacheKey ? 14 : null,
    city: '',
    external_id: '',
    place_context: cacheKey ? ('pub' as const) : ('private' as const),
    drink_type: 'beer' as const,
    beer: {
      name: 'Plzeň',
      price_czk: price,
      volume_ml: 500,
      serving_type: 'unknown' as const,
    },
    drank_at: '2026-07-19T18:00:00Z',
    is_suspect: false,
  };
}

function remoteVisit(clientId: string, cacheKey: string) {
  return {
    client_id: clientId,
    cache_key: cacheKey,
    name: 'Hospoda',
    lat: 50,
    lng: 14,
    city: null,
    external_id: null,
    started_at: '2026-07-19T18:00:00Z',
    ended_at: '2026-07-19T20:00:00Z',
    updated_at: '2026-07-19T20:00:00Z',
  };
}

function localSession(clientId: string, pubKey: string, drinkIds: string[]): TallySession {
  return {
    clientId,
    pubKey,
    pubName: 'Lokální hospoda',
    startedAt: '2026-07-19T18:00:00Z',
    drinks: drinkIds.map((id, index) => ({
      id,
      beerName: 'Plzeň',
      priceCzk: 60,
      at: `2026-07-19T1${8 + index}:00:00Z`,
      syncStatus: 'pending',
    })),
  };
}

beforeEach(() => jest.clearAllMocks());

it('loads an authoritative beer and visit snapshot on a new device', async () => {
  const drinks = [remoteDrink('d1', PUB_A), remoteDrink('d2', PUB_B)];
  const visits = [remoteVisit('v1', PUB_A), remoteVisit('v2', PUB_B)];
  (fetchDrinks as jest.Mock).mockResolvedValue(drinks);
  (fetchVisits as jest.Mock).mockResolvedValue(visits);

  await expect(reconcileDiarySnapshot()).resolves.toEqual({ drinks, visits });
  expect(flushDrinksQueue).toHaveBeenCalledTimes(1);
  expect(flushDeleteDrinksQueue).toHaveBeenCalledTimes(1);
  expect(flushUpdateDrinksQueue).toHaveBeenCalledTimes(1);
  expect(flushVisitsQueue).toHaveBeenCalledTimes(1);
  expect((flushDrinksQueue as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (fetchDrinks as jest.Mock).mock.invocationCallOrder[0],
  );
  expect((flushVisitsQueue as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
    (fetchVisits as jest.Mock).mock.invocationCallOrder[0],
  );
});

it('merges offline writes by client ID without double-counting synced rows', () => {
  const snapshot: DiarySnapshot = {
    drinks: [remoteDrink('already-synced', PUB_A)],
    visits: [remoteVisit('visit-synced', PUB_A)],
  };
  const local = [
    localSession('visit-synced', PUB_A, ['already-synced']),
    localSession('visit-offline', PUB_B, ['offline-drink']),
  ];

  expect(deriveReconciledDiaryStats(snapshot, local)).toEqual({
    totalBeers: 2,
    distinctPubs: 2,
    maxVisitsToOnePub: 1,
    totalSpentCzk: 120,
  });
});

it('uses only the server snapshot on a fresh install with no local history', () => {
  const snapshot: DiarySnapshot = {
    drinks: [remoteDrink('d1', PUB_A, 55), remoteDrink('d2', PUB_A, 65)],
    visits: [remoteVisit('v1', PUB_A)],
  };

  expect(deriveReconciledDiaryStats(snapshot, [])).toEqual({
    totalBeers: 2,
    distinctPubs: 1,
    maxVisitsToOnePub: 1,
    totalSpentCzk: 120,
  });
});
