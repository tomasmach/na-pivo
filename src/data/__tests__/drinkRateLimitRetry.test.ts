import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushDrinksQueue } from '../drinksQueue';
import { flushDeleteDrinksQueue } from '../deleteDrinksQueue';
import { flushUpdateDrinksQueue } from '../updateDrinksQueue';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => key === 'na-pivo-account'
    ? JSON.stringify({ deviceId: 'd', accountId: 'a', token: 'tok', authenticated: false })
    : null),
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
  jest.restoreAllMocks();
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
  expect(JSON.parse((await restartedStorage.getItem('na-pivo-drinks-retry-after'))!)).toEqual({
    accountId: 'a', retryAt: Date.now() + 5_000,
  });
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

it('retries the pending drink after a temporary secure-store failure at the deadline', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  const { flushDrinksQueue: flush } = require('../drinksQueue') as typeof import('../drinksQueue');
  await storage.setItem('na-pivo-drinks-queue', JSON.stringify([drink]));
  global.fetch = jest.fn().mockResolvedValueOnce(reply(429, '5')).mockResolvedValueOnce(reply(200));
  await flush();
  expect(global.fetch).toHaveBeenCalledTimes(1);

  jest.mocked(secureStore.getItemAsync).mockRejectedValueOnce(new Error('temporarily locked'));
  await jest.advanceTimersByTimeAsync(5_000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(await storage.getItem('na-pivo-drinks-queue')).not.toBeNull();
  await jest.advanceTimersByTimeAsync(2_100);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(await storage.getItem('na-pivo-drinks-queue')).toBeNull();
});

it('stops automatic session retries after three spaced attempts while keeping the drink queued', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  const { flushDrinksQueue: flush } = require('../drinksQueue') as typeof import('../drinksQueue');
  await storage.setItem('na-pivo-drinks-queue', JSON.stringify([drink]));
  global.fetch = jest.fn(async () => reply(429, '5'));
  await flush();
  jest.mocked(secureStore.getItemAsync).mockRejectedValue(new Error('still locked'));

  await jest.advanceTimersByTimeAsync(5_000 + 2_100 + 5_000 + 15_000);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(await storage.getItem('na-pivo-drinks-queue')).not.toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it.each([undefined, 'b'])(
  'cancels a transient session retry when the account boundary changes to %s',
  async (nextAccountId) => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
    const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
    const secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    const { flushDrinksQueue: flush } = require('../drinksQueue') as typeof import('../drinksQueue');
    const { clearDrinkRateLimit } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
    await storage.setItem('na-pivo-drinks-queue', JSON.stringify([drink]));
    global.fetch = jest.fn(async () => reply(429, '5'));
    await flush();
    jest.mocked(secureStore.getItemAsync).mockRejectedValueOnce(new Error('temporarily locked'));
    await jest.advanceTimersByTimeAsync(5_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await clearDrinkRateLimit(nextAccountId);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  },
);

it.each([
  'broken',
  '99999999999999999999',
  String(Date.parse('2026-09-29T16:00:30Z')),
  JSON.stringify({ accountId: 'a', retryAt: Date.parse('2026-09-30T16:00:00Z') + 1 }),
  JSON.stringify({ accountId: 'a', retryAt: '2026-09-29T16:00:30Z' }),
])(
  'ignores invalid persisted cooldown %s',
  async (raw) => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
    const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
    await storage.setItem('na-pivo-drinks-retry-after', raw);
    expect(await storage.getItem('na-pivo-drinks-retry-after')).toBe(raw);
    const { shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
    require('../account');
    expect(await shouldPauseDrinkSync()).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  },
);

it('does not restore another account’s cooldown after a restart, even if removal failed', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const firstStorage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const { noteDrinkThrottled } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  require('../account');
  await noteDrinkThrottled(reply(429, '60'));
  const saved = await firstStorage.getItem('na-pivo-drinks-retry-after');
  expect(saved).not.toBeNull();

  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const restartedStorage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  await restartedStorage.setItem('na-pivo-drinks-retry-after', saved!);
  jest.mocked(secureStore.getItemAsync).mockResolvedValue(JSON.stringify({
    deviceId: 'd2', accountId: 'b', token: 'new-token', authenticated: true,
  }));
  const { shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  require('../account');
  expect(await shouldPauseDrinkSync()).toBe(false);
  expect(await restartedStorage.getItem('na-pivo-drinks-retry-after')).toBe(saved);
});

it('retains a same-account cooldown while secure storage is temporarily unavailable', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  const { noteDrinkThrottled, shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  require('../account');
  await noteDrinkThrottled(reply(429, '60'));
  const saved = await storage.getItem('na-pivo-drinks-retry-after');
  jest.mocked(secureStore.getItemAsync).mockRejectedValueOnce(new Error('locked'));
  expect(await shouldPauseDrinkSync()).toBe(true);
  expect(await storage.getItem('na-pivo-drinks-retry-after')).toBe(saved);
  await jest.advanceTimersByTimeAsync(2_000);
  expect(await shouldPauseDrinkSync()).toBe(true);
});

it('accepts an HTTP-date Retry-After deadline', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const { noteDrinkThrottled, shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  require('../account');
  await noteDrinkThrottled(reply(429, new Date(Date.now() + 5_000).toUTCString()));
  expect(await shouldPauseDrinkSync()).toBe(true);
  await jest.advanceTimersByTimeAsync(4_999);
  expect(await shouldPauseDrinkSync()).toBe(true);
  await jest.advanceTimersByTimeAsync(1);
  expect(await shouldPauseDrinkSync()).toBe(false);
});

it('lets the replacement account GET drinks immediately after private data is cleared', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const { getDrinkRateLimitGeneration, noteDrinkThrottled } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  const { clearLocalPrivateAccountData } = require('../privateAccountData') as typeof import('../privateAccountData');
  const { fetchDrinks } = require('../drinksClient') as typeof import('../drinksClient');
  await noteDrinkThrottled(reply(429, '60'));
  global.fetch = jest.fn(async () => ({ ...reply(200), json: async () => ({ drinks: [] }) }));

  expect(await fetchDrinks()).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  const previousGeneration = getDrinkRateLimitGeneration();
  await clearLocalPrivateAccountData();
  // A response from a request sent by the old account may arrive afterward.
  await noteDrinkThrottled(reply(429, '60'), previousGeneration);
  expect(await storage.getItem('na-pivo-drinks-retry-after')).toBeNull();
  expect(await fetchDrinks()).toEqual([]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('finishes private-data cleanup when removing the old cooldown fails', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const { noteDrinkThrottled, shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  const { clearLocalPrivateAccountData } = require('../privateAccountData') as typeof import('../privateAccountData');
  await noteDrinkThrottled(reply(429, '60'));
  const originalRemove = (storage.removeItem as jest.Mock).getMockImplementation() as typeof storage.removeItem;
  jest.spyOn(storage, 'removeItem').mockImplementation((key) =>
    key === 'na-pivo-drinks-retry-after'
      ? Promise.reject(new Error('storage unavailable'))
      : originalRemove(key),
  );

  await expect(clearLocalPrivateAccountData()).resolves.toBeUndefined();
  expect(await shouldPauseDrinkSync()).toBe(false);
});

it('ignores an old storage read that finishes after the account boundary', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const key = 'na-pivo-drinks-retry-after';
  const oldDeadline = JSON.stringify({ accountId: 'a', retryAt: Date.now() + 60_000 });
  await storage.setItem(key, oldDeadline);
  const originalGet = (storage.getItem as jest.Mock).getMockImplementation() as typeof storage.getItem;
  let finishRead!: (value: string) => void;
  let startRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { startRead = resolve; });
  jest.spyOn(storage, 'getItem').mockImplementation((requestedKey) =>
    requestedKey === key
      ? new Promise<string>((resolve) => { finishRead = resolve; startRead(); })
      : originalGet(requestedKey),
  );
  const { shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  const { clearLocalPrivateAccountData } = require('../privateAccountData') as typeof import('../privateAccountData');
  require('../account');
  const reading = shouldPauseDrinkSync();
  await readStarted;
  await clearLocalPrivateAccountData();
  finishRead(oldDeadline);
  expect(await reading).toBe(false);
  expect(await shouldPauseDrinkSync()).toBe(false);
});

it('removes an old cooldown write that was pending at the account boundary', async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T16:00:00Z'));
  const storage = require('@react-native-async-storage/async-storage') as typeof AsyncStorage;
  const key = 'na-pivo-drinks-retry-after';
  const originalSet = (storage.setItem as jest.Mock).getMockImplementation() as typeof storage.setItem;
  let finishWrite!: () => void;
  jest.spyOn(storage, 'setItem').mockImplementation((requestedKey, value) =>
    requestedKey === key
      ? new Promise<void>((resolve) => {
          finishWrite = () => { void originalSet(requestedKey, value).then(resolve); };
        })
      : originalSet(requestedKey, value),
  );
  const { noteDrinkThrottled, shouldPauseDrinkSync } = require('../drinksRateLimit') as typeof import('../drinksRateLimit');
  const { clearLocalPrivateAccountData } = require('../privateAccountData') as typeof import('../privateAccountData');
  const writing = noteDrinkThrottled(reply(429, '60'));
  for (let i = 0; !finishWrite && i < 20; i++) await Promise.resolve();
  expect(finishWrite).toBeDefined();
  const clearing = clearLocalPrivateAccountData();
  finishWrite();
  await Promise.all([writing, clearing]);
  expect(await storage.getItem(key)).toBeNull();
  expect(await shouldPauseDrinkSync()).toBe(false);
});
