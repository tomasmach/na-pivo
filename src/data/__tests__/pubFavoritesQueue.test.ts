jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const submitFavorite = jest.fn();
jest.mock('../pubFavoritesClient', () => ({
  submitFavorite: (...args: unknown[]) => submitFavorite(...args),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearPubFavoritesQueue, enqueueFavoriteOp } from '../pubFavoritesQueue';

const STORAGE_KEY = 'na-pivo-pub-favorites-queue';

function op(pubKey: string, favorite: boolean) {
  return {
    pubKey,
    payload: { name: pubKey, lat: 50.08, lng: 14.42, favorite, updated_at: '2026-09-28T12:00:00Z' },
  };
}

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

    const first = enqueueFavoriteOp(op('u2fkbnjj', false));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = enqueueFavoriteOp(op('u2fkbnhz', false));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The second removal is on disk even though the first send has not returned.
    expect(await stored()).toEqual(['u2fkbnjj', 'u2fkbnhz']);

    finishFirst('ok');
    await Promise.all([first, second]);
    expect(await stored()).toEqual([]);
  });

  it('stops sending when an account boundary clears the queue', async () => {
    let finishFirst!: (value: string) => void;
    submitFavorite.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    submitFavorite.mockResolvedValue('ok');

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([op('u2fkbnjj', true), op('u2fkbnhz', true)]));
    const flush = enqueueFavoriteOp(op('u2fkbnjk', true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await clearPubFavoritesQueue();
    finishFirst('ok');
    await flush;

    expect(submitFavorite).toHaveBeenCalledTimes(1);
    expect(await stored()).toEqual([]);
  });
});
