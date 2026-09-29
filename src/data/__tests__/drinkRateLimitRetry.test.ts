import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushDrinksQueue } from '../drinksQueue';
import { flushDeleteDrinksQueue } from '../deleteDrinksQueue';
import { flushUpdateDrinksQueue } from '../updateDrinksQueue';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('../account', () => ({
  ...jest.requireActual('../account'),
  ensureAccount: jest.fn(async () => ({ deviceId: 'd', accountId: 'a', token: 'tok' })),
}));
jest.mock('../telemetryClient', () => ({
  trackApiFailure: jest.fn(),
  trackClientEvent: jest.fn(async () => undefined),
}));

const originalFetch = global.fetch;
const originalUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
const clientId = '00000000-0000-4000-8000-000000000041';
const drink = {
  client_id: clientId,
  name: 'Testovací hospoda',
  lat: 50.0876,
  lng: 14.4214,
  beer: { name: 'Plzeň', volume_ml: 500 },
  drank_at: '2026-09-29T18:40:00+02:00',
};

function reply(status: number, retryAfter?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null },
    json: async () => ({}),
  } as Response;
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  await AsyncStorage.clear();
  process.env.EXPO_PUBLIC_BACKEND_URL = 'http://127.0.0.1:8012';
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = originalUrl;
});

it('holds every drink operation after 429, restores its cooldown after restart, then completes the same IDs', async () => {
  const postKey = 'na-pivo-drinks-queue';
  const deleteKey = 'na-pivo-delete-drinks-queue';
  const patchKey = 'na-pivo-update-drinks-queue';
  await AsyncStorage.setItem(postKey, JSON.stringify([drink]));
  await AsyncStorage.setItem(deleteKey, JSON.stringify(['00000000-0000-4000-8000-000000000042']));
  await AsyncStorage.setItem(patchKey, JSON.stringify([{ client_id: '00000000-0000-4000-8000-000000000043', beer_name: 'Kozel' }]));

  global.fetch = jest.fn(async () => reply(429, '5'));
  await flushDrinksQueue();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await flushDeleteDrinksQueue();
  await flushUpdateDrinksQueue();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem(postKey))!)).toEqual([drink]);
  expect(JSON.parse((await AsyncStorage.getItem(deleteKey))!)).toHaveLength(1);
  expect(JSON.parse((await AsyncStorage.getItem(patchKey))!)).toHaveLength(1);

  const saved = await AsyncStorage.multiGet([postKey, deleteKey, patchKey, 'na-pivo-drinks-retry-after']);
  jest.clearAllTimers();
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const restartedStorage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  await restartedStorage.clear();
  await restartedStorage.multiSet(saved.filter((pair): pair is [string, string] => pair[1] !== null));
  expect(await restartedStorage.getItem(postKey)).not.toBeNull();
  expect(await restartedStorage.getItem('na-pivo-drinks-retry-after')).toBe(String(Date.now() + 5_000));
  const restartedPost = require('../drinksQueue') as typeof import('../drinksQueue');
  const restartedDelete = require('../deleteDrinksQueue') as typeof import('../deleteDrinksQueue');
  const restartedPatch = require('../updateDrinksQueue') as typeof import('../updateDrinksQueue');

  global.fetch = jest.fn(async () => reply(200));
  await Promise.all([
    restartedPost.flushDrinksQueue(),
    restartedDelete.flushDeleteDrinksQueue(),
    restartedPatch.flushUpdateDrinksQueue(),
  ]);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBeGreaterThan(0);
  await jest.advanceTimersByTimeAsync(4_999);
  expect(global.fetch).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect((global.fetch as jest.Mock).mock.calls.map(([url, init]) => [url, init.method]).sort()).toEqual([
    ['http://127.0.0.1:8012/v1/drinks/00000000-0000-4000-8000-000000000042', 'DELETE'],
    ['http://127.0.0.1:8012/v1/drinks/00000000-0000-4000-8000-000000000043', 'PATCH'],
    ['http://127.0.0.1:8012/v1/drinks', 'POST'],
  ].sort());
  const post = (global.fetch as jest.Mock).mock.calls.find(([_url, init]) => init.method === 'POST');
  expect(JSON.parse(post[1].body).client_id).toBe(clientId);
  expect(await restartedStorage.getItem(postKey)).toBeNull();
  expect(await restartedStorage.getItem(deleteKey)).toBeNull();
  expect(await restartedStorage.getItem(patchKey)).toBeNull();
});

it.each(['broken', '99999999999999999999'])(
  'ignores invalid persisted cooldown %s',
  async (raw) => {
    await AsyncStorage.setItem('na-pivo-drinks-retry-after', raw);
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
    const { shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
    expect(await shouldPauseDrinkSync()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  },
);

it('accepts an HTTP-date Retry-After deadline', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const { noteDrinkThrottled, shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  await noteDrinkThrottled(reply(429, new Date(Date.now() + 5_000).toUTCString()));
  expect(await shouldPauseDrinkSync()).toBe(true);
  await jest.advanceTimersByTimeAsync(4_999);
  expect(await shouldPauseDrinkSync()).toBe(true);
  await jest.advanceTimersByTimeAsync(1);
  expect(await shouldPauseDrinkSync()).toBe(false);
});
