import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearCachedAccount, ensureAccount, getOrCreateDeviceId } from '../account';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const DEVICE_ID_KEY = 'na-pivo-device-id';
const ACCOUNT_KEY = 'na-pivo-account';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setBackend(url: string | undefined): void {
  if (url === undefined) {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
  } else {
    process.env.EXPO_PUBLIC_BACKEND_URL = url;
  }
}

/** Build a fetch mock that returns one OK JSON body. */
function mockFetchOk(body: unknown): jest.Mock {
  return jest.fn(async () => ({ ok: true, json: async () => body }));
}

beforeEach(() => {
  // Clear the in-memory AsyncStorage mock so persisted ids/accounts don't bleed.
  (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {};
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  setBackend(ORIGINAL_URL);
  jest.clearAllMocks();
});

describe('getOrCreateDeviceId', () => {
  it('returns a UUID-shaped string, persists it, and is stable across calls', async () => {
    const first = await getOrCreateDeviceId();

    expect(typeof first).toBe('string');
    expect(first).toMatch(UUID_RE);

    // Persisted under the documented key.
    expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBe(first);

    // A second call returns the SAME id.
    const second = await getOrCreateDeviceId();
    expect(second).toBe(first);
  });
});

describe('ensureAccount — dormant feature', () => {
  it('resolves to null without calling fetch but still persists a deviceId', async () => {
    setBackend(undefined);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(session).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    const deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    expect(deviceId).toMatch(UUID_RE);
  });
});

describe('ensureAccount — registration (no cache yet)', () => {
  it('POSTs { device_id } to <base>/v1/account, returns the session, and caches it with the deviceId', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = mockFetchOk({
      id: 'acc-123',
      device_id: 'will-be-ignored',
      token: 'secret-token',
      created: true,
      created_at: '2026-06-09T12:00:00+02:00',
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/account');
    expect(init.method).toBe('POST');

    const persistedDeviceId = (await AsyncStorage.getItem(DEVICE_ID_KEY)) as string;
    expect(persistedDeviceId).toMatch(UUID_RE);

    expect(JSON.parse(init.body as string)).toEqual({ device_id: persistedDeviceId });

    expect(session).toEqual({
      deviceId: persistedDeviceId,
      accountId: 'acc-123',
      token: 'secret-token',
    });

    // Cache blob includes the deviceId it was minted for.
    const cached = JSON.parse((await AsyncStorage.getItem(ACCOUNT_KEY)) as string);
    expect(cached).toEqual({
      deviceId: persistedDeviceId,
      accountId: 'acc-123',
      token: 'secret-token',
    });
  });

  it('resolves to null (never throws) on a network failure with no cache', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(ensureAccount()).resolves.toBeNull();
  });

  it('resolves to null on a non-OK HTTP response with no cache', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(ensureAccount()).resolves.toBeNull();
  });
});

describe('ensureAccount — already established (once-per-install)', () => {
  it('returns the cached session WITHOUT calling fetch when the cache matches the deviceId', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await AsyncStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' })
    );
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session).toEqual({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
  });

  it('returns the cached session even when the backend is dormant', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await AsyncStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' })
    );
    setBackend(undefined);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session).toEqual({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
  });
});

describe('ensureAccount — cache desync guard', () => {
  it('ignores a cached account minted for a DIFFERENT deviceId and re-registers the current one', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-A');
    await AsyncStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({ deviceId: 'dev-B', accountId: 'old-acc', token: 'old-tok' })
    );
    setBackend('https://api.example.com');
    const fetchSpy = mockFetchOk({ id: 'new-acc', token: 'new-tok' });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    // It registered the CURRENT deviceId, not the stale cached one.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ device_id: 'dev-A' });

    expect(session).toEqual({ deviceId: 'dev-A', accountId: 'new-acc', token: 'new-tok' });

    // Cache was overwritten with the current device's account.
    const cached = JSON.parse((await AsyncStorage.getItem(ACCOUNT_KEY)) as string);
    expect(cached).toEqual({ deviceId: 'dev-A', accountId: 'new-acc', token: 'new-tok' });
  });
});

describe('clearCachedAccount', () => {
  it('removes the cached account so the next ensureAccount re-registers', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await AsyncStorage.setItem(
      ACCOUNT_KEY,
      JSON.stringify({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' })
    );

    await clearCachedAccount();
    expect(await AsyncStorage.getItem(ACCOUNT_KEY)).toBeNull();
    // The deviceId anchor is preserved.
    expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBe('dev-1');

    // With the cache gone, ensureAccount registers afresh.
    setBackend('https://api.example.com');
    global.fetch = mockFetchOk({ id: 'acc-2', token: 'tok-2' }) as unknown as typeof fetch;

    const session = await ensureAccount();
    expect(session).toEqual({ deviceId: 'dev-1', accountId: 'acc-2', token: 'tok-2' });
  });
});
