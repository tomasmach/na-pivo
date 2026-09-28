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
  runWithoutPubFavoritesSync,
} from '../pubFavoritesSync';
import { sanitizeFavorites, usePubFavoritesStore } from '@/stores/pubFavoritesStore';

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
    fetchFavorites.mockResolvedValue([wire()]);
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
    fetchFavorites.mockResolvedValue([wire()]);
    await restorePubFavorites();
    expect(enqueueFavoriteOp).toHaveBeenCalledWith({
      pubKey: OTHER,
      payload: expect.objectContaining({ favorite: true }),
    });
  });

  it('does not bring back a heart whose removal is still queued', async () => {
    getQueuedFavoriteRemovalKeys.mockResolvedValue(new Set([PUB]));
    fetchFavorites.mockResolvedValue([wire()]);
    await restorePubFavorites();
    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeUndefined();
  });

  it('keeps a newer local copy over an older server one', async () => {
    usePubFavoritesStore.setState({
      favorites: { [PUB]: { ...TYGR, name: 'Tygr', updatedAt: '2026-09-28T13:00:00.000Z' } },
    });
    fetchFavorites.mockResolvedValue([wire()]);
    await restorePubFavorites();
    expect(usePubFavoritesStore.getState().favorites[PUB]?.name).toBe('Tygr');
  });

  it('reports a failed pull without touching local state', async () => {
    usePubFavoritesStore.getState().toggleFavorite(PUB, TYGR);
    fetchFavorites.mockResolvedValue(null);
    await expect(restorePubFavorites()).resolves.toBe(false);
    expect(usePubFavoritesStore.getState().favorites[PUB]).toBeDefined();
  });
});
