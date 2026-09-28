jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const fetchFavorites = jest.fn();
jest.mock('../pubFavoritesClient', () => ({
  fetchFavorites: (...args: unknown[]) => fetchFavorites(...(args as [])),
}));

const enqueueFavoriteOp: jest.Mock = jest.fn((_item?: unknown) => Promise.resolve(undefined));
const flushPubFavoritesQueue: jest.Mock = jest.fn(() => Promise.resolve(undefined));
const getQueuedFavoriteRemovalKeys: jest.Mock = jest.fn(async () => new Set<string>());
jest.mock('../pubFavoritesQueue', () => ({
  enqueueFavoriteOp: (...args: unknown[]) => enqueueFavoriteOp(...(args as [])),
  flushPubFavoritesQueue: () => flushPubFavoritesQueue(),
  getQueuedFavoriteRemovalKeys: () => getQueuedFavoriteRemovalKeys(),
}));

import {
  installPubFavoritesSync,
  restorePubFavorites,
  clearLocalPubFavorites,
  runWithoutPubFavoritesSync,
} from '../pubFavoritesSync';
import { geohash8 } from '../geohash';
import {
  findFavoriteKey,
  isSameVenue,
  sanitizeFavorites,
  usePubFavoritesStore,
  wipeFavoritesForAccountBoundary,
} from '@/stores/pubFavoritesStore';

const PUB = 'u2fkbnjj';
const OTHER = 'u2fkbnhz';
const TYGR = { name: 'U Zlatého tygra', lat: 50.0876, lng: 14.4211, city: 'Praha' };

function wire(over: Record<string, unknown> = {}) {
  return {
    cache_key: PUB,
    name: 'U Zlatého tygra',
    lat: 50.0876,
    lng: 14.4211,
    external_id: 'mapy:1',
    updated_at: '2026-09-28T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getQueuedFavoriteRemovalKeys.mockResolvedValue(new Set<string>());
  usePubFavoritesStore.setState({ favorites: {} });
});

describe('pubFavoritesStore', () => {
  it('saves and removes a pub with one toggle each', () => {
    expect(usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR)).toBe(true);
    expect(usePubFavoritesStore.getState().favorites[PUB]).toMatchObject(TYGR);
    expect(usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR)).toBe(false);
    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeUndefined();
  });

  it('keeps only well-formed persisted entries', () => {
    expect(
      sanitizeFavorites({
        favorites: {
          [PUB]: { ...TYGR, updatedAt: '2026-09-28T12:00:00.000Z' },
          [OTHER]: { name: 'Bez polohy', updatedAt: '2026-09-28T12:00:00.000Z' },
          // Point of a different cell under this key.
          u2fkbnhy: { ...TYGR, updatedAt: '2026-09-28T12:00:00.000Z' },
          'not-a-key': { ...TYGR, updatedAt: '2026-09-28T12:00:00.000Z' },
        },
      }),
    ).toEqual({ [PUB]: { ...TYGR, updatedAt: '2026-09-28T12:00:00.000Z' } });
    expect(sanitizeFavorites(null)).toEqual({});
    expect(sanitizeFavorites({ favorites: 'garbage' })).toEqual({});
  });
});

describe('installPubFavoritesSync', () => {
  it('queues a save for a new heart and a timestamped removal for a removed one', () => {
    const unsubscribe = installPubFavoritesSync();
    usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR);
    expect(enqueueFavoriteOp).toHaveBeenLastCalledWith({
      pubKey: PUB,
      payload: expect.objectContaining({ name: TYGR.name, favorite: true }),
    });
    usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR);
    expect(enqueueFavoriteOp).toHaveBeenLastCalledWith({
      pubKey: PUB,
      payload: expect.objectContaining({ favorite: false, updated_at: expect.any(String) }),
    });
    unsubscribe();
  });

  it('does not sync an account-boundary wipe', () => {
    usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR);
    const unsubscribe = installPubFavoritesSync();
    runWithoutPubFavoritesSync(() => usePubFavoritesStore.setState({ favorites: {} }));
    expect(enqueueFavoriteOp).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('restorePubFavorites', () => {
  it('merges server favourites without echoing them back', async () => {
    fetchFavorites.mockResolvedValue({ favorites: [wire()], removed: [] });
    const unsubscribe = installPubFavoritesSync();
    await expect(restorePubFavorites()).resolves.toBe(true);
    expect(usePubFavoritesStore.getState().favorites[PUB]).toMatchObject({
      name: 'U Zlatého tygra',
      externalId: 'mapy:1',
    });
    expect(enqueueFavoriteOp).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('pushes a local favourite the server does not have', async () => {
    usePubFavoritesStore.setState({
      favorites: { [OTHER]: { ...TYGR, updatedAt: '2026-09-28T10:00:00.000Z' } },
    });
    fetchFavorites.mockResolvedValue({ favorites: [wire()], removed: [] });
    await restorePubFavorites();
    expect(enqueueFavoriteOp).toHaveBeenCalledWith({
      pubKey: OTHER,
      payload: expect.objectContaining({ favorite: true }),
    });
  });

  it('does not bring back a heart whose removal is still queued', async () => {
    getQueuedFavoriteRemovalKeys.mockResolvedValue(new Set([PUB]));
    fetchFavorites.mockResolvedValue({ favorites: [wire()], removed: [] });
    await restorePubFavorites();
    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeUndefined();
  });

  it('keeps a newer local copy over an older server one', async () => {
    usePubFavoritesStore.setState({
      favorites: { [PUB]: { ...TYGR, name: 'Tygr', updatedAt: '2026-09-28T13:00:00.000Z' } },
    });
    fetchFavorites.mockResolvedValue({ favorites: [wire()], removed: [] });
    await restorePubFavorites();
    expect(usePubFavoritesStore.getState().favorites[PUB]?.name).toBe('Tygr');
  });

  it('drops a heart removed on another phone and does not push it back', async () => {
    usePubFavoritesStore.setState({
      favorites: { [PUB]: { ...TYGR, updatedAt: '2026-09-28T12:00:00.000Z' } },
    });
    fetchFavorites.mockResolvedValue({
      favorites: [],
      removed: [{ cache_key: PUB, updated_at: '2026-09-28T12:00:00.000Z' }],
    });
    const unsubscribe = installPubFavoritesSync();

    await restorePubFavorites();

    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeUndefined();
    expect(enqueueFavoriteOp).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps and pushes a heart saved after the removal', async () => {
    usePubFavoritesStore.setState({
      favorites: { [PUB]: { ...TYGR, updatedAt: '2026-09-28T13:00:00.000Z' } },
    });
    fetchFavorites.mockResolvedValue({
      favorites: [],
      removed: [{ cache_key: PUB, updated_at: '2026-09-28T12:00:00.000Z' }],
    });

    await restorePubFavorites();

    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeDefined();
    expect(enqueueFavoriteOp).toHaveBeenCalledWith({
      pubKey: PUB,
      payload: expect.objectContaining({ favorite: true }),
    });
  });

  it('reports a failed pull without touching local state', async () => {
    usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR);
    fetchFavorites.mockResolvedValue(null);
    await expect(restorePubFavorites()).resolves.toBe(false);
    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeDefined();
  });
});

describe('restorePubFavorites across an account boundary', () => {
  it('drops a pull that was in flight when the account changed', async () => {
    let answer!: (value: unknown) => void;
    fetchFavorites.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const pull = restorePubFavorites();
    await Promise.resolve();
    await Promise.resolve();

    clearLocalPubFavorites();
    answer({ favorites: [wire()], removed: [] });

    await expect(pull).resolves.toBe(false);
    expect(usePubFavoritesStore.getState().favorites).toEqual({});
    expect(enqueueFavoriteOp).not.toHaveBeenCalled();
  });

  it('keeps a heart off that was removed while the pull was in flight', async () => {
    usePubFavoritesStore.setState({
      favorites: { [PUB]: { ...TYGR, updatedAt: '2026-09-28T12:00:00.000Z' } },
    });
    const unsubscribe = installPubFavoritesSync();
    let answer!: (value: unknown) => void;
    fetchFavorites.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const pull = restorePubFavorites();
    await Promise.resolve();
    await Promise.resolve();

    usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR);
    answer({ favorites: [wire()], removed: [] });

    await expect(pull).resolves.toBe(true);
    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeUndefined();
    unsubscribe();
  });
});

describe('favourite identity', () => {
  const saved = { ...TYGR, externalId: 'mapy:1', updatedAt: '2026-09-28T12:00:00.000Z' };

  it('tells a saved pub from a neighbour in the same cell', () => {
    expect(isSameVenue(saved, { id: 'mapy:1', name: 'U Zlatého tygra' })).toBe(true);
    expect(isSameVenue(saved, { id: 'mapy:2', name: 'Vinárna vedle' })).toBe(false);
    expect(isSameVenue(saved, { id: '', name: 'U Zlatého tygra' })).toBe(true);
    expect(isSameVenue({ name: 'U Zlatého tygra' }, { id: 'mapy:2', name: 'Vinárna vedle' })).toBe(false);
  });

  it('keeps two businesses with one name apart when both ids are known', () => {
    expect(isSameVenue(saved, { id: 'mapy:2', name: 'U Zlatého tygra' })).toBe(false);
    // A pub added in the app gets a new coordinate id when its pin moves.
    const own = { ...saved, externalId: 'mapy:50.08700,14.42000' };
    expect(isSameVenue(own, { id: 'mapy:50.08701,14.42001', name: 'U Zlatého tygra' })).toBe(true);
  });

  it('moves the heart of an own pub whose pin moved', () => {
    const own = { ...TYGR, externalId: 'mapy:50.08700,14.42000', updatedAt: '2026-09-28T12:00:00.000Z' };
    usePubFavoritesStore.setState({ favorites: { [PUB]: own } });
    const moved = { name: 'U Zlatého tygra', lat: 50.0875, lng: 14.4207, externalId: 'mapy:50.08750,14.42070' };
    usePubFavoritesStore.getState().movePubFavorite('mapy:50.08700,14.42000', moved);
    const favorites = usePubFavoritesStore.getState().favorites;
    expect(Object.keys(favorites)).toEqual([geohash8(50.0875, 14.4207)]);
    expect(Object.values(favorites)[0]).toMatchObject(moved);
    // Nothing happens for a pub without a heart.
    usePubFavoritesStore.getState().movePubFavorite('mapy:elsewhere', { ...moved, lat: 49 });
    expect(usePubFavoritesStore.getState().favorites).toBe(favorites);
  });

  it('finds the heart in the cell, or by provider id after a pin moved', () => {
    expect(findFavoriteKey({ [PUB]: saved }, PUB, { id: 'mapy:1', name: 'x' })).toBe(PUB);
    expect(findFavoriteKey({ [PUB]: saved }, PUB, { id: 'mapy:2', name: 'Vinárna vedle' })).toBeUndefined();
    expect(findFavoriteKey({ [PUB]: saved }, OTHER, { id: 'mapy:1', name: 'x' })).toBe(PUB);
  });
});

// Keep last: the wipe flag is process-wide, like a real account boundary.
describe('launch read racing the first pull', () => {
  it('waits for the stored hearts, so server rows are not pushed back as removals', async () => {
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage');
    let finishRead!: (value: string | null) => void;
    const getItem = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    fetchFavorites.mockResolvedValue({ favorites: [wire()], removed: [] });
    const unsubscribe = installPubFavoritesSync();

    const hydration = usePubFavoritesStore.persist.rehydrate();
    const restore = restorePubFavorites();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchFavorites).not.toHaveBeenCalled();

    finishRead(JSON.stringify({ state: { favorites: {} }, version: 0 }));
    await hydration;
    await restore;

    expect(usePubFavoritesStore.getState().favorites[PUB]).toMatchObject({ name: 'U Zlatého tygra' });
    const removals = enqueueFavoriteOp.mock.calls.filter(
      ([item]) => (item as { payload: { favorite: boolean } }).payload.favorite === false,
    );
    expect(removals).toEqual([]);
    unsubscribe();
    getItem.mockRestore();
  });
});

describe('launch read after an account boundary', () => {
  it('does not restore the previous account from storage', async () => {
    const AsyncStorage = jest.requireMock('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(
      'na-pivo-pub-favorites',
      JSON.stringify({ state: { favorites: { [PUB]: { ...TYGR, updatedAt: '2026-09-28T12:00:00.000Z' } } }, version: 0 }),
    );
    wipeFavoritesForAccountBoundary();
    await usePubFavoritesStore.persist.rehydrate();
    expect(usePubFavoritesStore.getState().favorites).toEqual({});
  });
});
