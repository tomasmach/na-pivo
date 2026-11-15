import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearDiaryCache, DIARY_CACHE_KEY } from '../diaryCache';
import {
  deriveReconciledDiaryStats,
  diaryIdsHash,
  mergeServerDiaryHistory,
  reconcileDiarySnapshot,
  restoreAccountDiary,
  type DiarySnapshot,
} from '../diarySync';
import { fetchDrinks, type WireDrink } from '../drinksClient';
import { flushDrinksQueue } from '../drinksQueue';
import { flushDeleteDrinksQueue, getQueuedDeleteIds } from '../deleteDrinksQueue';
import { flushUpdateDrinksQueue, getQueuedUpdateIds } from '../updateDrinksQueue';
import { fetchVisits, type WireVisit } from '../visitsClient';
import { flushVisitsQueue, getQueuedVisitDeleteIds } from '../visitsQueue';
import capturedSnapshot from './fixtures/accountDiarySnapshot.json';
import { t } from '@/i18n';
import { useCommunityStore } from '@/stores/communityStore';
import { drinkingDayKey, useTallyStore, type TallySession } from '@/stores/tallyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/data/account', () => ({ generateUuidV4: jest.fn(() => 'uuid') }));
jest.mock('@/data/visitsSync', () => ({ deleteVisitByClientId: jest.fn(), syncVisit: jest.fn() }));

jest.mock('../drinksClient', () => ({
  fetchDrinks: jest.fn(),
  isWireDrink: (drink: { drank_at?: unknown }) => typeof drink.drank_at === 'string',
}));
jest.mock('../visitsClient', () => ({
  fetchVisits: jest.fn(),
  isWireVisit: (visit: { started_at?: unknown }) => typeof visit.started_at === 'string',
}));
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

/** What a backend without `?since=` support answers. */
function released(key: 'drinks' | 'visits', rows: unknown[]) {
  return { accountId: 'acc', body: { [key]: rows } };
}

function answer(
  key: 'drinks' | 'visits',
  rows: { client_id: string }[],
  { all, since, removed = [], live = rows, accountId = 'acc' }: {
    all: boolean;
    since: string;
    removed?: string[];
    live?: { client_id: string }[];
    accountId?: string;
  },
) {
  return {
    accountId,
    body: {
      [key]: rows,
      removed,
      full: all,
      next_since: since,
      total: live.length,
      ids_hash: diaryIdsHash(live),
    },
  };
}

beforeEach(async () => {
  await clearDiaryCache();
  jest.clearAllMocks();
  useTallyStore.setState({ current: null, history: [], restoredAccountId: null });
  useCommunityStore.setState({ overrides: {} });
});

it('loads an authoritative beer and visit snapshot on a new device', async () => {
  const drinks = [remoteDrink('d1', PUB_A), remoteDrink('d2', PUB_B)];
  const visits = [remoteVisit('v1', PUB_A), remoteVisit('v2', PUB_B)];
  (fetchDrinks as jest.Mock).mockResolvedValue(released('drinks', drinks));
  (fetchVisits as jest.Mock).mockResolvedValue(released('visits', visits));

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
    return released('drinks', [
      remote('radek', 'Radegast Ryze Hořká 12°'),
      remote('edited', 'Primátor 11°'),
      remote('renamed', 'Pilsner Urquell'),
      remote('same', 'Kozel 11'),
    ]);
  });
  (fetchVisits as jest.Mock).mockResolvedValue(released('visits', []));
  (getQueuedUpdateIds as jest.Mock).mockResolvedValueOnce(new Set(['edited']));

  await reconcileDiarySnapshot();

  expect(useTallyStore.getState().history[0].drinks.map((drink) => drink.beerName)).toEqual([
    'Radegast Ryze Hořká 12°',
    'Primátor 11',
    'Bernard 11',
    'Kozel 11',
  ]);
});

it('spells the pub\'s local menu like the server, without making it newer', async () => {
  const session = localSession('s1', PUB_A, ['radek']);
  session.drinks[0].beerName = 'Radek 12';
  useTallyStore.setState({ current: null, history: [session] });
  const radegast = { name: 'Radegast Ryze Hořká 12°', priceCzk: 45, volumeMl: 500 };
  useCommunityStore.setState({
    overrides: {
      [PUB_A]: {
        beers: [{ name: 'Radek 12', priceCzk: 45, volumeMl: 500 }, radegast, { name: 'Radek 12', priceCzk: 30, volumeMl: 300 }],
        beersOverrideUpdatedAt: 7,
        updatedAt: 7,
      },
    },
  });
  const drink = remoteDrink('radek', PUB_A);
  (fetchDrinks as jest.Mock).mockResolvedValue(released('drinks', [{ ...drink, beer: { ...drink.beer, name: radegast.name } }]));
  (fetchVisits as jest.Mock).mockResolvedValue(released('visits', []));

  await reconcileDiarySnapshot();

  expect(useCommunityStore.getState().overrides[PUB_A]).toEqual({
    beers: [radegast, { name: radegast.name, priceCzk: 30, volumeMl: 300 }],
    beersOverrideUpdatedAt: 7,
    updatedAt: 7,
  });
});

it('keeps a name whose queued edit lands while the snapshot is read', async () => {
  const session = localSession('s1', PUB_A, ['edited']);
  session.drinks[0].beerName = 'Primátor 11';
  useTallyStore.setState({ current: null, history: [session] });
  const drink = remoteDrink('edited', PUB_A);
  (fetchDrinks as jest.Mock).mockResolvedValue(released('drinks', [{ ...drink, beer: { ...drink.beer, name: 'Plzeň' } }]));
  (fetchVisits as jest.Mock).mockResolvedValue(released('visits', []));
  // Queued when the pull starts, delivered by another flush before it ends.
  (getQueuedUpdateIds as jest.Mock)
    .mockResolvedValueOnce(new Set(['edited']))
    .mockResolvedValueOnce(new Set());

  await reconcileDiarySnapshot();

  expect(useTallyStore.getState().history[0].drinks[0].beerName).toBe('Primátor 11');
});

it('leaves out a removed drink whose deletion is still queued', async () => {
  const visits = [remoteVisit('v1', PUB_A)];
  (fetchDrinks as jest.Mock).mockResolvedValue(released('drinks', [
    remoteDrink('kept', PUB_A),
    remoteDrink('removed', PUB_A),
  ]));
  (fetchVisits as jest.Mock).mockResolvedValue(released('visits', visits));
  (getQueuedDeleteIds as jest.Mock).mockResolvedValueOnce(new Set(['removed']));

  const snapshot = await reconcileDiarySnapshot();

  expect(snapshot).toEqual({ drinks: [remoteDrink('kept', PUB_A)], visits });
  expect(deriveReconciledDiaryStats(snapshot!, []).totalBeers).toBe(1);
});

it('leaves out a wiped evening whose visit DELETE is still queued', async () => {
  (fetchDrinks as jest.Mock).mockResolvedValue(released('drinks', []));
  (fetchVisits as jest.Mock).mockResolvedValue(released('visits', [remoteVisit('kept', PUB_A), remoteVisit('wiped', PUB_B)]));
  (getQueuedVisitDeleteIds as jest.Mock).mockResolvedValueOnce(new Set(['wiped']));

  const snapshot = await reconcileDiarySnapshot();

  expect(snapshot?.visits).toEqual([remoteVisit('kept', PUB_A)]);
  expect(deriveReconciledDiaryStats(snapshot!, []).distinctPubs).toBe(1);
});

describe('downloading only what changed', () => {
  const drinkAt = (id: string, hour: number, name = 'Plzeň') => {
    const drink = remoteDrink(id, PUB_A);
    return { ...drink, drank_at: `2026-07-19T${hour}:00:00Z`, beer: { ...drink.beer, name } };
  };
  const cursors = (mock: unknown) => (mock as jest.Mock).mock.calls.map(([cursor]) => cursor);

  it('asks for the changes since the last read and keeps the whole diary', async () => {
    const session = localSession('s1', PUB_A, ['d2']);
    session.drinks[0].beerName = 'Radek 12';
    session.drinks[0].syncStatus = 'sent';
    useTallyStore.setState({ current: null, history: [session] });
    const visit = remoteVisit('v1', PUB_A);
    (fetchDrinks as jest.Mock).mockResolvedValueOnce(
      answer('drinks', [drinkAt('d1', 18), drinkAt('d2', 19, 'Radek 12')], { all: true, since: '100' }),
    );
    (fetchVisits as jest.Mock).mockResolvedValueOnce(answer('visits', [visit], { all: true, since: '100' }));
    await reconcileDiarySnapshot();

    const renamed = drinkAt('d2', 19, 'Radegast Ryze Hořká 12°');
    const added = drinkAt('d3', 20);
    (fetchDrinks as jest.Mock).mockResolvedValueOnce(
      answer('drinks', [renamed, added], { all: false, since: '200', removed: ['d1'], live: [renamed, added] }),
    );
    (fetchVisits as jest.Mock).mockResolvedValueOnce(answer('visits', [], { all: false, since: '200', live: [visit] }));

    const snapshot = await reconcileDiarySnapshot();

    expect(cursors(fetchDrinks)).toEqual([null, { accountId: 'acc', since: '100' }]);
    expect(cursors(fetchVisits)).toEqual([null, { accountId: 'acc', since: '100' }]);
    expect(snapshot).toEqual({ drinks: [added, renamed], visits: [visit] });
    expect(useTallyStore.getState().history[0].drinks[0].beerName).toBe('Radegast Ryze Hořká 12°');
  });

  it('downloads everything again when the changes do not add up', async () => {
    const all = [drinkAt('d1', 18), drinkAt('d2', 19), drinkAt('d3', 20)];
    (fetchDrinks as jest.Mock)
      .mockResolvedValueOnce(answer('drinks', all.slice(0, 2), { all: true, since: '100' }))
      .mockResolvedValueOnce(answer('drinks', [], { all: false, since: '200', live: all }))
      .mockResolvedValueOnce(answer('drinks', all, { all: true, since: '300' }));
    (fetchVisits as jest.Mock).mockResolvedValue(answer('visits', [], { all: true, since: '100' }));
    await reconcileDiarySnapshot();

    const snapshot = await reconcileDiarySnapshot();

    expect(cursors(fetchDrinks)).toEqual([null, { accountId: 'acc', since: '100' }, null]);
    expect(snapshot?.drinks).toEqual([...all].reverse());
  });

  it('never mixes the diaries of two accounts', async () => {
    (fetchDrinks as jest.Mock)
      .mockResolvedValueOnce(answer('drinks', [drinkAt('mine', 18)], { all: true, since: '100' }))
      .mockResolvedValueOnce(answer('drinks', [drinkAt('theirs', 19)], { all: true, since: '500', accountId: 'other' }))
      .mockResolvedValueOnce(answer('drinks', [], { all: false, since: '600', accountId: 'other', live: [drinkAt('theirs', 19)] }));
    (fetchVisits as jest.Mock)
      .mockResolvedValueOnce(answer('visits', [], { all: true, since: '100' }))
      .mockResolvedValueOnce(answer('visits', [], { all: true, since: '500', accountId: 'other' }))
      .mockResolvedValueOnce(answer('visits', [], { all: false, since: '600', accountId: 'other' }));
    await reconcileDiarySnapshot();

    expect((await reconcileDiarySnapshot())?.drinks).toEqual([drinkAt('theirs', 19)]);
    expect((await reconcileDiarySnapshot())?.drinks).toEqual([drinkAt('theirs', 19)]);
    expect(cursors(fetchDrinks)[2]).toEqual({ accountId: 'other', since: '500' });
  });

  it('keeps no copy when the backend still sends the old full list', async () => {
    (fetchDrinks as jest.Mock).mockResolvedValue(released('drinks', [drinkAt('d1', 18)]));
    (fetchVisits as jest.Mock).mockResolvedValue(released('visits', []));

    await reconcileDiarySnapshot();
    await reconcileDiarySnapshot();

    expect(cursors(fetchDrinks)).toEqual([null, null]);
    expect(await AsyncStorage.getItem(DIARY_CACHE_KEY)).toBeNull();
  });

  it('does not keep a diary read while the account changed', async () => {
    (fetchDrinks as jest.Mock).mockImplementationOnce(async () => {
      await clearDiaryCache();
      return answer('drinks', [drinkAt('d1', 18)], { all: true, since: '100' });
    });
    (fetchVisits as jest.Mock).mockResolvedValue(answer('visits', [], { all: true, since: '100' }));
    await reconcileDiarySnapshot();
    (fetchDrinks as jest.Mock).mockResolvedValueOnce(answer('drinks', [], { all: true, since: '200' }));

    await reconcileDiarySnapshot();

    expect(cursors(fetchDrinks)).toEqual([null, null]);
  });

  it('continues from the copy saved by the last launch and ignores a damaged one', async () => {
    const stored = drinkAt('d1', 18);
    await AsyncStorage.setItem(
      DIARY_CACHE_KEY,
      JSON.stringify({ accountId: 'acc', drinks: { since: '100', rows: [stored] }, visits: { since: '100', rows: [] }, fullReadAt: Date.now() }),
    );
    (fetchDrinks as jest.Mock).mockResolvedValueOnce(answer('drinks', [], { all: false, since: '200', live: [stored] }));
    (fetchVisits as jest.Mock).mockResolvedValueOnce(answer('visits', [], { all: false, since: '200' }));

    expect((await reconcileDiarySnapshot())?.drinks).toEqual([stored]);
    expect(cursors(fetchDrinks)).toEqual([{ accountId: 'acc', since: '100' }]);

    await clearDiaryCache();
    await AsyncStorage.setItem(DIARY_CACHE_KEY, '{"accountId":"acc","drinks":');
    (fetchDrinks as jest.Mock).mockResolvedValueOnce(answer('drinks', [stored], { all: true, since: '300' }));
    (fetchVisits as jest.Mock).mockResolvedValueOnce(answer('visits', [], { all: true, since: '300' }));

    expect((await reconcileDiarySnapshot())?.drinks).toEqual([stored]);
    expect(cursors(fetchDrinks)[1]).toBeNull();
  });

  it('downloads the whole diary again once a day, also from a copy saved before that rule', async () => {
    const hour = 60 * 60 * 1000;
    const start = Date.parse('2026-07-20T10:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const stored = drinkAt('d1', 18);
    await AsyncStorage.setItem(
      DIARY_CACHE_KEY,
      JSON.stringify({ accountId: 'acc', drinks: { since: '100', rows: [stored] }, visits: { since: '100', rows: [] } }),
    );
    (fetchDrinks as jest.Mock)
      .mockResolvedValueOnce(answer('drinks', [stored], { all: true, since: '200' }))
      .mockResolvedValueOnce(answer('drinks', [], { all: false, since: '300', live: [stored] }))
      .mockResolvedValueOnce(answer('drinks', [stored], { all: true, since: '400' }));
    (fetchVisits as jest.Mock)
      .mockResolvedValueOnce(answer('visits', [], { all: true, since: '200' }))
      .mockResolvedValueOnce(answer('visits', [], { all: false, since: '300' }))
      .mockResolvedValueOnce(answer('visits', [], { all: true, since: '400' }));

    await reconcileDiarySnapshot();
    now.mockReturnValue(start + 23 * hour);
    await reconcileDiarySnapshot();
    now.mockReturnValue(start + 25 * hour);
    await reconcileDiarySnapshot();

    expect(cursors(fetchDrinks)).toEqual([null, { accountId: 'acc', since: '200' }, null]);
    expect(cursors(fetchVisits)).toEqual([null, { accountId: 'acc', since: '200' }, null]);
    now.mockRestore();
  });

  it('counts a day from the last whole read, also when a mismatch caused it', async () => {
    const hour = 60 * 60 * 1000;
    const start = Date.parse('2026-07-20T10:00:00Z');
    const now = jest.spyOn(Date, 'now').mockReturnValue(start);
    const stored = drinkAt('d1', 18);
    const visit = remoteVisit('v1', PUB_A);
    (fetchDrinks as jest.Mock)
      .mockResolvedValueOnce(answer('drinks', [], { all: true, since: '100' }))
      .mockResolvedValueOnce(answer('drinks', [], { all: false, since: '200', live: [stored] }))
      .mockResolvedValueOnce(answer('drinks', [stored], { all: true, since: '300' }))
      .mockResolvedValueOnce(answer('drinks', [], { all: false, since: '400', live: [stored] }));
    (fetchVisits as jest.Mock)
      .mockResolvedValueOnce(answer('visits', [], { all: true, since: '100' }))
      .mockResolvedValueOnce(answer('visits', [], { all: false, since: '200', live: [visit] }))
      .mockResolvedValueOnce(answer('visits', [visit], { all: true, since: '300' }))
      .mockResolvedValueOnce(answer('visits', [], { all: false, since: '400', live: [visit] }));

    await reconcileDiarySnapshot();
    now.mockReturnValue(start + 23 * hour);
    await reconcileDiarySnapshot();
    now.mockReturnValue(start + 25 * hour);
    await reconcileDiarySnapshot();

    expect(cursors(fetchDrinks)).toEqual([null, { accountId: 'acc', since: '100' }, null, { accountId: 'acc', since: '300' }]);
    expect(cursors(fetchVisits)).toEqual([null, { accountId: 'acc', since: '100' }, null, { accountId: 'acc', since: '300' }]);
    now.mockRestore();
  });

  it('counts client IDs the way the backend does', () => {
    const ids = [
      'e5e40835-f85f-58b8-8805-49f48d519a6c',
      '9a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d',
      'ffffffff-0000-4000-8000-000000000000',
    ];
    expect(diaryIdsHash(ids.map((client_id) => ({ client_id })))).toBe('805f7491');
  });
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

describe('restoring the account history into the diary', () => {
  /** Device-local time in July 2026, so drinking days do not depend on the TZ. */
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 6, day, hour, minute).toISOString();

  function pubDrink(clientId: string, drankAt: string, cacheKey = PUB_A): WireDrink {
    return { ...remoteDrink(clientId, cacheKey), drank_at: drankAt };
  }

  function homeDrink(clientId: string, drankAt: string): WireDrink {
    return { ...remoteDrink(clientId, null), drank_at: drankAt };
  }

  function visit(
    clientId: string,
    cacheKey: string,
    startedAt: string,
    endedAt: string | null,
    closedAt: string | null = endedAt,
  ): WireVisit {
    return {
      ...remoteVisit(clientId, cacheKey),
      started_at: startedAt,
      ended_at: endedAt,
      closed_at: closedAt,
      updated_at: closedAt ?? endedAt ?? startedAt,
    };
  }

  const ids = (sessions: TallySession[] | null) =>
    sessions?.map((session) => [session.clientId, session.drinks.map((drink) => drink.id)]);

  it('files pub drinks under the visit they were poured in', () => {
    const visits = [
      visit('v1', PUB_A, at(10, 18), at(10, 20), at(10, 20, 15)),
      visit('v2', PUB_B, at(10, 21), at(10, 22), null),
    ];
    const drinks = [pubDrink('d3', at(10, 22), PUB_B), pubDrink('d2', at(10, 20)), pubDrink('d1', at(10, 18))];

    const history = mergeServerDiaryHistory({ drinks, visits }, null, []);

    expect(ids(history)).toEqual([
      ['v2', ['d3']],
      ['v1', ['d1', 'd2']],
    ]);
    expect(history?.[1]).toEqual({
      clientId: 'v1',
      pubKey: PUB_A,
      pubName: 'Hospoda',
      startedAt: at(10, 18),
      archivedReason: 'manual',
      closedAt: at(10, 20, 15),
      visitUpdatedAt: at(10, 20, 15),
      drinks: [
        { id: 'd1', beerName: 'Plzeň', priceCzk: 60, volumeMl: 500, at: at(10, 18), syncStatus: 'sent', restored: true },
        { id: 'd2', beerName: 'Plzeň', priceCzk: 60, volumeMl: 500, at: at(10, 20), syncStatus: 'sent', restored: true },
      ],
    });
    // A visit still open on the server can be resumed like a timed-out evening.
    expect(history?.[0]).toMatchObject({ pubKey: PUB_B, archivedReason: 'timeout' });
    expect(history?.[0]).not.toHaveProperty('closedAt');
  });

  it('groups drinks outside a pub by place and drinking day across midnight', () => {
    const drinks = [
      homeDrink('late', at(11, 1, 30)),
      homeDrink('first', at(10, 23)),
      homeDrink('next-day', at(11, 18)),
      homeDrink('broken', 'not a date'),
    ];

    const history = mergeServerDiaryHistory({ drinks, visits: [] }, null, []);

    expect(ids(history)).toEqual([
      ['next-day', ['next-day']],
      ['first', ['first', 'late']],
    ]);
    expect(history?.[1]).toMatchObject({
      pubKey: 'ctx:private',
      pubName: t.counter.outsideLabel('private'),
      placeContext: 'private',
      startedAt: at(10, 23),
      archivedReason: 'manual',
    });
  });

  it('skips drinks the diary already has and adds the rest to the same local evening', () => {
    const local = localSession('v1', PUB_A, ['d1']);
    const added = { ...remoteDrink('d2', PUB_A), drank_at: '2026-07-19T19:00:00Z' };

    const history = mergeServerDiaryHistory(
      { drinks: [remoteDrink('d1', PUB_A), added], visits: [remoteVisit('v1', PUB_A)] },
      null,
      [local],
    );

    expect(ids(history)).toEqual([['v1', ['d1', 'd2']]]);
    expect(history?.[0].drinks[0]).toBe(local.drinks[0]);
    expect(history?.[0].drinks[1]).toMatchObject({ restored: true, syncStatus: 'sent' });
  });

  it('leaves the live evening alone', () => {
    const current = localSession('live', PUB_A, ['c1']);
    useTallyStore.setState({ current, history: [] });

    restoreAccountDiary(
      {
        drinks: [remoteDrink('c1', PUB_A), { ...remoteDrink('c2', PUB_A), drank_at: '2026-07-19T19:00:00Z' }],
        visits: [remoteVisit('live', PUB_A)],
      },
      'account-1',
    );

    expect(useTallyStore.getState().current).toBe(current);
    expect(useTallyStore.getState().history).toEqual([]);
  });

  it('fills only free history slots and never evicts a local evening', () => {
    const local = Array.from({ length: 45 }, (_, index) => ({
      ...localSession(`local-${index}`, PUB_A, [`l${index}`]),
      startedAt: new Date(2026, 0, 45 - index, 18).toISOString(),
    }));
    const server = Array.from({ length: 20 }, (_, index) =>
      homeDrink(`s${index}`, new Date(2026, 2, 1 + index, 20).toISOString()),
    );

    const history = mergeServerDiaryHistory({ drinks: server, visits: [] }, null, local);

    expect(history).toHaveLength(50);
    expect(history?.slice(0, 5).map((session) => session.clientId)).toEqual(['s19', 's18', 's17', 's16', 's15']);
    expect(history?.slice(5)).toEqual(local);
  });

  it('changes nothing the second time and restores only once per account', () => {
    const snapshot = {
      drinks: [pubDrink('d1', at(10, 18)), homeDrink('h1', at(10, 23))],
      visits: [visit('v1', PUB_A, at(10, 18), at(10, 20))],
    };
    const first = mergeServerDiaryHistory(snapshot, null, []);
    expect(mergeServerDiaryHistory(snapshot, null, first!)).toBeNull();

    restoreAccountDiary(snapshot, 'account-1');
    expect(useTallyStore.getState()).toMatchObject({ history: first, restoredAccountId: 'account-1' });
    // The user deleted the restored evenings; the next pull must not bring them back.
    useTallyStore.setState({ history: [] });
    restoreAccountDiary(snapshot, 'account-1');
    expect(useTallyStore.getState().history).toEqual([]);
  });

  it('keeps a drink at its own pub when only a pub 40 m away has a visit that night', () => {
    const drink = { ...pubDrink('d1', at(10, 20)), lat: 50.08804, lng: 14.42076 };
    const nextDoor = {
      ...visit('v1', PUB_B, at(10, 19), at(10, 22)),
      name: 'U Souseda',
      external_id: 'next-door',
      lat: 50.0884,
      lng: 14.42076,
    };

    const history = mergeServerDiaryHistory({ drinks: [drink], visits: [nextDoor] }, null, []);

    expect(ids(history)).toEqual([['d1', ['d1']]]);
    expect(history?.[0]).toMatchObject({ pubKey: PUB_A, pubName: 'Hospoda' });
    expect(history?.[0]).not.toHaveProperty('pubExternalId');
  });

  it('keeps a drink at its own pub when the overlapping visit is somewhere else', () => {
    const brno = { ...visit('v1', 'u2ezcgsw', at(10, 18), at(10, 22)), lat: 49.1951, lng: 16.6068 };
    const history = mergeServerDiaryHistory({ drinks: [pubDrink('d1', at(10, 20))], visits: [brno] }, null, []);

    expect(ids(history)).toEqual([['d1', ['d1']]]);
    expect(history?.[0]).toMatchObject({ pubKey: PUB_A, pubName: 'Hospoda' });

    const withoutPlace = { ...pubDrink('d2', at(10, 20), 'u2fkbnzz'), lat: null, lng: null };
    const nearby = visit('v2', PUB_B, at(10, 18), at(10, 22));
    expect(ids(mergeServerDiaryHistory({ drinks: [withoutPlace], visits: [nearby] }, null, []))).toEqual([
      ['d2', ['d2']],
    ]);
  });

  it('keeps a drink at its own pub when that pub has another visit the same day', () => {
    const history = mergeServerDiaryHistory(
      {
        drinks: [pubDrink('d1', at(10, 18)), pubDrink('d2', at(10, 21, 30))],
        visits: [visit('v1', PUB_A, at(10, 18), at(10, 18)), visit('v2', PUB_B, at(10, 21), at(10, 23))],
      },
      null,
      [],
    );

    expect(ids(history)).toEqual([['v1', ['d1', 'd2']]]);
  });

  it('restores a payload captured from the backend after logout and login', () => {
    const snapshot = capturedSnapshot as unknown as DiarySnapshot;
    const [pubVisit] = snapshot.visits;

    const history = mergeServerDiaryHistory(snapshot, null, [])!;

    const pubEvening = history.find((session) => session.clientId === pubVisit.client_id);
    expect(pubEvening).toMatchObject({
      pubKey: pubVisit.cache_key,
      pubName: 'U Restore testu',
      pubCity: 'Praha',
      startedAt: '2026-10-17T16:00:00.000Z',
      archivedReason: 'manual',
      closedAt: '2026-10-17T19:45:00.000Z',
    });
    expect(pubEvening?.drinks.map((drink) => [drink.beerName, drink.drinkType])).toEqual([
      ['Pilsner Urquell', undefined],
      ['Velkopopovický Kozel 11°', undefined],
      ['Kofola', 'soft_drink'],
    ]);

    const homeDrinks = snapshot.drinks.filter((drink) => drink.place_context === 'private');
    const homeEvenings = history.filter((session) => session.pubKey === 'ctx:private');
    expect(homeEvenings.flatMap((session) => session.drinks.map((drink) => drink.id)).sort()).toEqual(
      homeDrinks.map((drink) => drink.client_id).sort(),
    );
    expect(homeEvenings).toHaveLength(
      new Set(homeDrinks.map((drink) => drinkingDayKey(new Date(drink.drank_at)))).size,
    );
    expect(history.flatMap((session) => session.drinks)).toHaveLength(snapshot.drinks.length);
    expect(
      history.every((session) => session.drinks.every((drink) => drink.restored && drink.syncStatus === 'sent')),
    ).toBe(true);
    expect(deriveReconciledDiaryStats(snapshot, history)).toEqual(deriveReconciledDiaryStats(snapshot, []));

    const suspect = { ...pubDrink('suspect', at(12, 20), 'u2fkbnzz'), is_suspect: true };
    const withSuspect = { ...snapshot, drinks: [...snapshot.drinks, suspect] };
    expect(deriveReconciledDiaryStats(withSuspect, mergeServerDiaryHistory(withSuspect, null, [])!)).toEqual(
      deriveReconciledDiaryStats(withSuspect, []),
    );
  });
});
