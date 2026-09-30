import type { AmenityQueueItem } from '../pubAmenitiesQueue';

const mockStorage = new Map<string, string>();
let mockKeychainAvailable = false;
let mockAccount = JSON.stringify({
  deviceId: 'device-1',
  accountId: 'account-1',
  token: 'local-test-token',
  authenticated: true,
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockStorage.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockStorage.delete(key); }),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => {
    if (!mockKeychainAvailable) throw Object.assign(new Error('locked'), { code: 'ERR_KEY_CHAIN' });
    return mockAccount;
  }),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
}));

jest.mock('../telemetryClient', () => ({
  trackApiFailure: jest.fn(),
  trackClientEvent: jest.fn(async () => undefined),
  setTelemetrySession: jest.fn(),
}));

const QUEUE_KEY = 'na-pivo-pub-amenities-queue';
const originalFetch = global.fetch;
const originalBackend = process.env.EXPO_PUBLIC_BACKEND_URL;

function item(op: 'upsert' | 'delete' = 'upsert'): AmenityQueueItem {
  return {
    op,
    pubKey: 'u28z5u4p::u testu',
    amenityKey: 'game_darts',
    payload: {
      name: 'U Testu',
      lat: 50.08,
      lng: 14.42,
      amenity_key: 'game_darts',
      value: op === 'delete' ? null : 'yes',
      taxonomy_version: 1,
      client_updated_at: '2026-09-29T12:00:00.000Z',
    },
  };
}

function readPersistedQueue(): AmenityQueueItem[] {
  return JSON.parse(mockStorage.get(QUEUE_KEY) ?? '[]') as AmenityQueueItem[];
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  mockStorage.clear();
  mockKeychainAvailable = false;
  mockAccount = JSON.stringify({
    deviceId: 'device-1', accountId: 'account-1', token: 'local-test-token', authenticated: true,
  });
  process.env.EXPO_PUBLIC_BACKEND_URL = 'http://127.0.0.1:8123';
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  global.fetch = originalFetch;
  if (originalBackend === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = originalBackend;
});

it.each([
  ['upsert', true],
  ['delete', false],
] as const)('retains a %s for an authenticated=%s account and sends it after Keychain recovers while active', async (op, authenticated) => {
  mockAccount = JSON.stringify({
    deviceId: 'device-1', accountId: 'account-1', token: 'local-test-token', authenticated,
  });
  const queue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  await queue.enqueueAmenityOp(item(op));
  await queue.flushPubAmenitiesQueue();

  expect(readPersistedQueue()).toEqual([item(op)]);
  expect(global.fetch).not.toHaveBeenCalled();

  mockKeychainAvailable = true;
  await jest.advanceTimersByTimeAsync(2_200);

  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8123/v1/pub-amenities/votes',
    expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer local-test-token' }),
      body: JSON.stringify({ votes: [item(op).payload] }),
    }),
  );
  expect(readPersistedQueue()).toEqual([]);
});

it.each([
  ['upsert', false],
  ['delete', true],
] as const)('keeps a %s for an authenticated=%s account across a JS restart', async (op, authenticated) => {
  mockAccount = JSON.stringify({
    deviceId: 'device-1', accountId: 'account-1', token: 'local-test-token', authenticated,
  });
  const firstQueue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  await firstQueue.enqueueAmenityOp(item(op));
  await firstQueue.flushPubAmenitiesQueue();
  expect(readPersistedQueue()).toEqual([item(op)]);

  jest.clearAllTimers(); // the old process is gone; AsyncStorage remains
  jest.resetModules();
  mockKeychainAvailable = true;
  const relaunchedQueue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  const relaunchedAccount = require('../account') as typeof import('../account');
  await expect(relaunchedAccount.ensureAccount()).resolves.toMatchObject({
    accountId: 'account-1', token: 'local-test-token', authenticated,
  });
  await relaunchedQueue.flushPubAmenitiesQueue();

  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8123/v1/pub-amenities/votes',
    expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ Authorization: 'Bearer local-test-token' }),
      body: JSON.stringify({ votes: [item(op).payload] }),
    }),
  );
  expect(readPersistedQueue()).toEqual([]);
});

it('keeps a retraction across restart even when its previous vote was still sending', async () => {
  mockKeychainAvailable = true;
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  global.fetch = jest.fn(() => {
    requestStarted();
    return new Promise(() => undefined);
  }) as unknown as typeof fetch;

  const firstQueue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  await firstQueue.enqueueAmenityOp(item());
  void firstQueue.flushPubAmenitiesQueue();
  await started;
  const retraction = item('delete');
  await firstQueue.enqueueAmenityOp(retraction);
  expect(readPersistedQueue()).toEqual([retraction]);

  jest.clearAllTimers(); // terminate the old JS process with its request still pending
  jest.resetModules();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  const relaunchedQueue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  await relaunchedQueue.flushPubAmenitiesQueue();

  expect(global.fetch).toHaveBeenCalledWith(
    'http://127.0.0.1:8123/v1/pub-amenities/votes',
    expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ votes: [retraction.payload] }),
    }),
  );
  expect(readPersistedQueue()).toEqual([]);
});

it('does not retry while backgrounded; a later foreground flush delivers the retained vote', async () => {
  const queue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  const { AppState } = require('react-native') as typeof import('react-native');
  await queue.enqueueAmenityOp(item());
  await queue.flushPubAmenitiesQueue();
  AppState.currentState = 'background';
  mockKeychainAvailable = true;

  await jest.advanceTimersByTimeAsync(25_000);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(readPersistedQueue()).toEqual([item()]);

  AppState.currentState = 'active';
  await queue.flushPubAmenitiesQueue();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(readPersistedQueue()).toEqual([]);
});

it('keeps sibling votes without one account-unavailable report per item', async () => {
  const queue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  const telemetry = require('../telemetryClient') as typeof import('../telemetryClient');
  const sibling: AmenityQueueItem = {
    ...item(),
    amenityKey: 'practical_wifi',
    payload: { ...item().payload, amenity_key: 'practical_wifi' },
  };
  await queue.enqueueAmenityOp(item());
  await queue.enqueueAmenityOp(sibling);
  await queue.flushPubAmenitiesQueue();

  expect(readPersistedQueue()).toEqual([item(), sibling]);
  expect(jest.mocked(telemetry.trackClientEvent).mock.calls.filter(
    ([event]) => event.event === 'amenity_vote_failed',
  )).toHaveLength(1);

  mockKeychainAvailable = true;
  await jest.advanceTimersByTimeAsync(2_200);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(readPersistedQueue()).toEqual([]);
});

it('limits retries for a session that stays unavailable', async () => {
  const queue = require('../pubAmenitiesQueue') as typeof import('../pubAmenitiesQueue');
  const SecureStore = require('expo-secure-store') as typeof import('expo-secure-store');
  await queue.enqueueAmenityOp(item());
  await queue.flushPubAmenitiesQueue();

  await jest.advanceTimersByTimeAsync(60_000);
  expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(4);
  expect(jest.getTimerCount()).toBe(0);
  expect(readPersistedQueue()).toEqual([item()]);
});
