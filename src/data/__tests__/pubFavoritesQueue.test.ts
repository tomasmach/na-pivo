jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const submitFavorite = jest.fn();
jest.mock('../pubFavoritesClient', () => ({
  submitFavorite: (...args: unknown[]) => submitFavorite(...args),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { geohash8 } from '../geohash';
import {
  clearPubFavoritesQueue,
  enqueueFavoriteOp,
  getQueuedFavoriteRemovalKeys,
} from '../pubFavoritesQueue';

const STORAGE_KEY = 'na-pivo-pub-favorites-queue';

/** The n-th pub on a line of cells, keyed by its own cell. */
function op(n: number, favorite: boolean) {
  const lat = 50 + n * 0.001;
  const lng = 14.42;
  return {
    pubKey: geohash8(lat, lng),
    payload: { name: `Pub ${n}`, lat, lng, favorite, updated_at: '2026-09-28T12:00:00Z' },
  };
}

const key = (n: number) => op(n, true).pubKey;

async function stored(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as { pubKey: string }[]).map((item) => item.pubKey) : [];
}

describe('pubFavoritesQueue', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('saves a second tap while the first request is still in flight', async () => {
    let finishFirst!: (value: string) => void;
    submitFavorite.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    submitFavorite.mockResolvedValue('ok');

    const first = enqueueFavoriteOp(op(1, false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = enqueueFavoriteOp(op(2, false));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The second removal is on disk even though the first send has not returned.
    expect(await stored()).toEqual([key(1), key(2)]);

    finishFirst('ok');
    await Promise.all([first, second]);
    expect(await stored()).toEqual([]);
  });

  it('stops sending when an account boundary clears the queue', async () => {
    let finishFirst!: (value: string) => void;
    submitFavorite.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    submitFavorite.mockResolvedValue('ok');

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op(1, true), op(2, true)]));
    const flush = enqueueFavoriteOp(op(3, true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await clearPubFavoritesQueue();
    finishFirst('ok');
    await flush;

    expect(submitFavorite).toHaveBeenCalledTimes(1);
    expect(await stored()).toEqual([]);
  });

  it('ignores a stored removal whose point lies in another cell', async () => {
    const stray = { ...op(1, false), pubKey: key(2) };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([stray, op(3, false)]));
    expect(await getQueuedFavoriteRemovalKeys()).toEqual(new Set([key(3)]));
  });

  it('drops the oldest saves, never a removal, when the queue is full', async () => {
    submitFavorite.mockResolvedValue('retry');
    const removal = op(0, false);
    const saves = Array.from({ length: 499 }, (_, i) => op(i + 1, true));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([removal, ...saves]));

    await enqueueFavoriteOp(op(600, true));

    const keys = await stored();
    expect(keys).toHaveLength(500);
    expect(keys[0]).toBe(key(0));
    expect(keys).not.toContain(key(1));
    expect(keys[keys.length - 1]).toBe(key(600));
  });
});
