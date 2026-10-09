import {
  deriveReconciledDiaryStats,
  reconcileDiarySnapshot,
  type DiarySnapshot,
} from '../diarySync';
import { fetchDrinks } from '../drinksClient';
import { flushDrinksQueue } from '../drinksQueue';
import { flushDeleteDrinksQueue, getQueuedDeleteIds } from '../deleteDrinksQueue';
import { flushUpdateDrinksQueue, getQueuedUpdateIds } from '../updateDrinksQueue';
import { fetchVisits } from '../visitsClient';
import { flushVisitsQueue, getQueuedVisitDeleteIds } from '../visitsQueue';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/data/account', () => ({ generateUuidV4: jest.fn(() => 'uuid') }));
jest.mock('@/data/visitsSync', () => ({ deleteVisitByClientId: jest.fn(), syncVisit: jest.fn() }));

jest.mock('../drinksClient', () => ({ fetchDrinks: jest.fn() }));
jest.mock('../visitsClient', () => ({ fetchVisits: jest.fn() }));
jest.mock('../drinksQueue', () => ({ flushDrinksQueue: jest.fn(async () => undefined) }));
jest.mock('../deleteDrinksQueue', () => ({
  flushDeleteDrinksQueue: jest.fn(async () => undefined),
  getQueuedDeleteIds: jest.fn(async () => new Set()),
}));
jest.mock('../updateDrinksQueue', () => ({
  flushUpdateDrinksQueue: jest.fn(async () => undefined),
  getQueuedUpdateIds: jest.fn(async () => new Set()),
}));
jest.mock('../visitsQueue', () => ({
  flushVisitsQueue: jest.fn(async () => undefined),
  getQueuedVisitDeleteIds: jest.fn(async () => new Set()),
}));

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

beforeEach(() => {
  jest.clearAllMocks();
  useTallyStore.setState({ current: null, history: [] });
});

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

it('gives the diary the server beer names but keeps a name the user is changing', async () => {
  const session = localSession('s1', PUB_A, ['radek', 'edited', 'renamed', 'same']);
  const names = ['Radek 12', 'Primátor 11', 'Plzeň', 'Kozel 11'];
  session.drinks.forEach((drink, index) => {
    drink.beerName = names[index];
    drink.syncStatus = 'sent';
  });
  useTallyStore.setState({ current: null, history: [session] });
  const remote = (id: string, name: string) => {
    const drink = remoteDrink(id, PUB_A);
    return { ...drink, beer: { ...drink.beer, name } };
  };
  (fetchDrinks as jest.Mock).mockImplementation(async () => {
    // The user renames this beer while the snapshot is on its way.
    useTallyStore.getState().updateDrinkNameInSession(session.startedAt, 'renamed', 'Bernard 11');
    return [
      remote('radek', 'Radegast Ryze Hořká 12°'),
      remote('edited', 'Primátor 11°'),
      remote('renamed', 'Pilsner Urquell'),
      remote('same', 'Kozel 11'),
    ];
  });
  (fetchVisits as jest.Mock).mockResolvedValue([]);
  (getQueuedUpdateIds as jest.Mock).mockResolvedValueOnce(new Set(['edited']));

  await reconcileDiarySnapshot();

  expect(useTallyStore.getState().history[0].drinks.map((drink) => drink.beerName)).toEqual([
    'Radegast Ryze Hořká 12°',
    'Primátor 11',
    'Bernard 11',
    'Kozel 11',
  ]);
});

it('leaves out a removed drink whose deletion is still queued', async () => {
  const visits = [remoteVisit('v1', PUB_A)];
  (fetchDrinks as jest.Mock).mockResolvedValue([
    remoteDrink('kept', PUB_A),
    remoteDrink('removed', PUB_A),
  ]);
  (fetchVisits as jest.Mock).mockResolvedValue(visits);
  (getQueuedDeleteIds as jest.Mock).mockResolvedValueOnce(new Set(['removed']));

  const snapshot = await reconcileDiarySnapshot();

  expect(snapshot).toEqual({ drinks: [remoteDrink('kept', PUB_A)], visits });
  expect(deriveReconciledDiaryStats(snapshot!, []).totalBeers).toBe(1);
});

it('leaves out a wiped evening whose visit DELETE is still queued', async () => {
  (fetchDrinks as jest.Mock).mockResolvedValue([]);
  (fetchVisits as jest.Mock).mockResolvedValue([remoteVisit('kept', PUB_A), remoteVisit('wiped', PUB_B)]);
  (getQueuedVisitDeleteIds as jest.Mock).mockResolvedValueOnce(new Set(['wiped']));

  const snapshot = await reconcileDiarySnapshot();

  expect(snapshot?.visits).toEqual([remoteVisit('kept', PUB_A)]);
  expect(deriveReconciledDiaryStats(snapshot!, []).distinctPubs).toBe(1);
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
