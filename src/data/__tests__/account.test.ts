import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  clearCachedAccount,
  clearCachedAnonymousAccount,
  ensureAccount,
  fetchAccountPreferences,
  getCachedAuthenticationState,
  getOrCreateDeviceId,
  revertToAnonymous,
  setSession,
  setAnonymousSessionEvictionListener,
  updateAccountPreferences,
} from '../account';
import {
  beginPrivateAccountTransition,
  PRIVATE_ACCOUNT_MERGE_STORAGE_KEY,
  preflightPrivateAccountMerge,
  resetPrivateAccountBoundaryForTests,
} from '../privateAccountBoundary';
import { setTelemetrySession, trackApiFailure } from '../telemetryClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// In-memory expo-secure-store mock. The account blob (which holds the bearer
// token) is persisted HERE — the Keychain/Keystore on device — not in plaintext
// AsyncStorage. __setStore resets the backing map between tests.
jest.mock('expo-secure-store', () => {
  let store: Record<string, string> = {};
  return {
    __setStore: (next: Record<string, string>) => {
      store = next;
    },
    getItemAsync: jest.fn(async (key: string) =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    ),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
    isAvailableAsync: jest.fn(async () => true),
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  };
});

jest.mock('../telemetryClient', () => ({
  setTelemetrySession: jest.fn(),
  trackApiFailure: jest.fn(),
}));

const secureStoreMock = SecureStore as unknown as {
  __setStore: (s: Record<string, string>) => void;
};
const mockTrackApiFailure = trackApiFailure as jest.MockedFunction<typeof trackApiFailure>;
const mockSetTelemetrySession = setTelemetrySession as jest.MockedFunction<typeof setTelemetrySession>;

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

/** Seed the secure-store-backed account cache. */
async function seedAccount(blob: {
  deviceId: string;
  accountId: string;
  token: string;
  authenticated?: boolean;
}): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(blob));
}

beforeEach(async () => {
  // Clear the in-memory AsyncStorage + SecureStore mocks so persisted
  // ids/accounts don't bleed across tests.
  (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {};
  resetPrivateAccountBoundaryForTests();
  secureStoreMock.__setStore({});
  setAnonymousSessionEvictionListener(null);
  await clearCachedAccount();
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

    // Persisted under the documented key (AsyncStorage — the deviceId is a
    // non-secret anchor, not a credential).
    expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBe(first);

    // A second call returns the SAME id.
    const second = await getOrCreateDeviceId();
    expect(second).toBe(first);
  });
});

describe('getCachedAuthenticationState', () => {
  it('reads signed-in, anonymous, and missing cached sessions without a network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(getCachedAuthenticationState()).resolves.toBe(false);

    await seedAccount({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'anonymous-token',
      authenticated: false,
    });
    await expect(getCachedAuthenticationState()).resolves.toBe(false);

    await seedAccount({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'signed-token',
      authenticated: true,
    });
    await expect(getCachedAuthenticationState()).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns unknown when SecureStore is temporarily unavailable', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(getCachedAuthenticationState()).resolves.toBeNull();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('session_cache_read', {
      reason: 'session_cache_read_unavailable',
    });
  });

  it('treats malformed SecureStore data as unavailable session data', async () => {
    secureStoreMock.__setStore({ [ACCOUNT_KEY]: '{not-json' });

    await expect(getCachedAuthenticationState()).resolves.toBe(false);
    expect(mockTrackApiFailure).toHaveBeenCalledWith('session_cache_read', {
      reason: 'session_cache_malformed',
    });
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
  it('does not mint unrelated C while an anonymous merge is unresolved', async () => {
    setBackend('https://api.example.test');
    await AsyncStorage.setItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY, JSON.stringify({
      version: 1,
      operationId: '9e0c0d0e-e194-4cf8-9399-e966a7c14f00',
      fromAccountId: 'account-a',
      toAccountId: null,
      preparedAt: Date.now(),
    }));
    resetPrivateAccountBoundaryForTests();
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(ensureAccount()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not mint an anonymous account when SecureStore is temporarily unavailable', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(ensureAccount()).resolves.toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('serves later calls from the in-memory session without re-reading SecureStore', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'signed-token',
      authenticated: true,
    });
    await expect(ensureAccount()).resolves.toMatchObject({ accountId: 'acc-1', authenticated: true });

    // Later Keychain flakiness cannot break an established session: the read
    // happened once on the cold path and every later call is memory-only.
    const readsAfterFirstCall = jest.mocked(SecureStore.getItemAsync).mock.calls.length;
    await expect(ensureAccount()).resolves.toMatchObject({
      accountId: 'acc-1',
      token: 'signed-token',
      authenticated: true,
    });
    expect(jest.mocked(SecureStore.getItemAsync).mock.calls.length).toBe(readsAfterFirstCall);
  });

  it('throws when an authenticated session cannot be persisted securely', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(
      setSession({ accountId: 'acc-1', token: 'signed-token', authenticated: true }),
    ).rejects.toThrow('Secure session persistence failed');
    expect(mockTrackApiFailure).toHaveBeenCalledWith('session_cache_write', {
      reason: 'session_cache_write_failed',
    });
  });

  it('POSTs { device_id } to <base>/v1/account, returns the session, and caches it (in SecureStore) with the deviceId', async () => {
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
      authenticated: false,
    });

    // The token-bearing blob lands in SecureStore, NOT AsyncStorage.
    expect(await AsyncStorage.getItem(ACCOUNT_KEY)).toBeNull();
    const cached = JSON.parse((await SecureStore.getItemAsync(ACCOUNT_KEY)) as string);
    expect(cached).toEqual({
      deviceId: persistedDeviceId,
      accountId: 'acc-123',
      token: 'secret-token',
      authenticated: false,
    });
  });

  it('shares an in-flight registration so startup callers do not race the same deviceId', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = mockFetchOk({
      id: 'acc-123',
      token: 'secret-token',
      created: true,
      created_at: '2026-06-09T12:00:00+02:00',
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const [first, second, third] = await Promise.all([
      ensureAccount(),
      ensureAccount(),
      ensureAccount(),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);

    const persistedDeviceId = (await AsyncStorage.getItem(DEVICE_ID_KEY)) as string;
    expect(first).toEqual({
      deviceId: persistedDeviceId,
      accountId: 'acc-123',
      token: 'secret-token',
      authenticated: false,
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
    expect(mockTrackApiFailure).toHaveBeenCalledWith('account_register', {
      endpoint: '/v1/account',
      status: 500,
    });
  });

  it('mints a fresh device account when the persisted deviceId is already claimed without account_register telemetry', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-locked');
    setBackend('https://api.example.com');
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'acc-2', token: 'tok-2' }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const [, secondInit] = fetchSpy.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(firstInit.body as string)).toEqual({ device_id: 'dev-locked' });
    const replacementDeviceId = JSON.parse(secondInit.body as string).device_id;
    expect(replacementDeviceId).toMatch(UUID_RE);
    expect(replacementDeviceId).not.toBe('dev-locked');
    expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBe(replacementDeviceId);
    expect(session).toEqual({
      deviceId: replacementDeviceId,
      accountId: 'acc-2',
      token: 'tok-2',
      authenticated: false,
    });
    expect(mockTrackApiFailure).not.toHaveBeenCalledWith(
      'account_register',
      expect.objectContaining({ status: 401 })
    );
  });

  it('reports a distinct recovery failure if the replacement deviceId is also rejected', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-locked');
    setBackend('https://api.example.com');
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(ensureAccount()).resolves.toBeNull();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockTrackApiFailure).toHaveBeenCalledWith('account_bootstrap', {
      endpoint: '/v1/account',
      status: 401,
      reason: 'bootstrap_replacement_rejected',
    });
    expect(mockTrackApiFailure).not.toHaveBeenCalledWith(
      'account_register',
      expect.objectContaining({ status: 401 })
    );
  });

  it('suppresses retry waves during bootstrap cooldown and resets backoff after success', async () => {
    jest.useFakeTimers();
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      jest.setSystemTime(new Date('2026-07-21T10:00:00Z'));
      await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-locked');
      setBackend('https://api.example.com');
      const fetchSpy = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'acc-2', token: 'tok-2' }) })
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'acc-3', token: 'tok-3' }) });
      global.fetch = fetchSpy as unknown as typeof fetch;

      await expect(ensureAccount()).resolves.toBeNull();
      await expect(Promise.all([ensureAccount(), ensureAccount(), ensureAccount()])).resolves.toEqual([
        null,
        null,
        null,
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mockTrackApiFailure).toHaveBeenCalledWith('account_bootstrap', {
        endpoint: '/v1/account',
        reason: 'bootstrap_retry_suppressed',
      });

      jest.advanceTimersByTime(30_001);
      await expect(ensureAccount()).resolves.toMatchObject({ accountId: 'acc-2' });

      // Remove the cached account (keeping backoff state untouched) so this
      // test can prove the successful bootstrap reset the exponential failure
      // counter itself. Goes through the module so the in-memory session
      // mirror is dropped too — production deletes always take this path.
      await clearCachedAccount({ resetBootstrapBackoff: false });
      await expect(ensureAccount()).resolves.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(5);

      jest.advanceTimersByTime(30_001);
      await expect(ensureAccount()).resolves.toMatchObject({ accountId: 'acc-3' });
      expect(fetchSpy).toHaveBeenCalledTimes(6);
    } finally {
      randomSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('resolves to null on a 2xx body missing id/token and caches nothing', async () => {
    setBackend('https://api.example.com');
    global.fetch = mockFetchOk({}) as unknown as typeof fetch;

    await expect(ensureAccount()).resolves.toBeNull();
    expect(await SecureStore.getItemAsync(ACCOUNT_KEY)).toBeNull();
  });

  it('resolves to null (never throws) when a 2xx body fails to parse as JSON', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    })) as unknown as typeof fetch;

    await expect(ensureAccount()).resolves.toBeNull();
    expect(await SecureStore.getItemAsync(ACCOUNT_KEY)).toBeNull();
  });
});

describe('ensureAccount — already established (once-per-install)', () => {
  it('returns the cached session WITHOUT calling fetch when the cache matches the deviceId', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session).toEqual({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'tok-1',
      authenticated: false,
    });
  });

  it('returns the cached session even when the backend is dormant', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend(undefined);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session).toEqual({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'tok-1',
      authenticated: false,
    });
  });
});

describe('ensureAccount — cache desync guard', () => {
  it('repairs a mismatched deviceId from the secure cached account without re-registering', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-A');
    await seedAccount({ deviceId: 'dev-B', accountId: 'old-acc', token: 'old-tok' });
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(session).toEqual({
      deviceId: 'dev-B',
      accountId: 'old-acc',
      token: 'old-tok',
      authenticated: false,
    });
    expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBe('dev-B');
  });

  it('serializes signal-bearing recovery callers into one coherent account transition', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-locked');
    setBackend('https://api.example.com');
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'acc-2', token: 'tok-2' }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const sessions = await Promise.all(
      controllers.map((controller) => ensureAccount(controller.signal)),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(new Set(sessions.map((session) => session?.deviceId)).size).toBe(1);
    expect(new Set(sessions.map((session) => session?.accountId))).toEqual(new Set(['acc-2']));

    const persistedDeviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    const cached = JSON.parse((await SecureStore.getItemAsync(ACCOUNT_KEY)) as string);
    expect(cached).toEqual({
      deviceId: persistedDeviceId,
      accountId: 'acc-2',
      token: 'tok-2',
      authenticated: false,
    });
  });
});

describe('ensureAccount — timeout & abort', () => {
  it('aborts a hanging request after the internal 8s timeout and resolves to null', async () => {
    jest.useFakeTimers();
    try {
      setBackend('https://api.example.com');
      // A fetch that never settles on its own — it only rejects when its signal
      // aborts, exactly like a real request killed by the timeout controller.
      const fetchSpy = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      );
      global.fetch = fetchSpy as unknown as typeof fetch;

      const pending = ensureAccount();
      // advanceTimersByTimeAsync also flushes the awaited deviceId/cache reads
      // that run before fetch, then fires the 8s timeout that aborts the request.
      await jest.advanceTimersByTimeAsync(8000);

      await expect(pending).resolves.toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null without fetching when handed an already-aborted signal', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    await expect(ensureAccount(controller.signal)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets one caller stop waiting without cancelling shared account recovery', async () => {
    setBackend('https://api.example.com');
    let resolveFetch!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
    const response = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = jest.fn(() => response);
    global.fetch = fetchSpy as unknown as typeof fetch;

    const controller = new AbortController();
    const cancelledCaller = ensureAccount(controller.signal);
    const survivingCaller = ensureAccount();
    controller.abort();

    await expect(cancelledCaller).resolves.toBeNull();
    resolveFetch({ ok: true, json: async () => ({ id: 'acc-1', token: 'tok-1' }) });
    await expect(survivingCaller).resolves.toMatchObject({ accountId: 'acc-1', token: 'tok-1' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('clearCachedAccount', () => {
  it('removes the cached account so the next ensureAccount creates a fresh account if needed', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });

    await clearCachedAccount();
    expect(await SecureStore.getItemAsync(ACCOUNT_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBe('dev-1');

    // With the token gone, a server-side claimed deviceId cannot recover the
    // account anymore; the client falls forward to a fresh anonymous account.
    setBackend('https://api.example.com');
    const fetchSpy = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'acc-2', token: 'tok-2' }) });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const session = await ensureAccount();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(session?.deviceId).toMatch(UUID_RE);
    expect(session?.deviceId).not.toBe('dev-1');
    expect(session?.accountId).toBe('acc-2');
    expect(session?.token).toBe('tok-2');
  });

  it('reports a SecureStore delete failure without throwing', async () => {
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(clearCachedAccount()).resolves.toBeUndefined();
    expect(mockTrackApiFailure).toHaveBeenCalledWith('session_cache_delete', {
      reason: 'session_cache_delete_failed',
    });
  });
});

describe('revertToAnonymous', () => {
  it('keeps A bearer and private data while its anonymous merge is unresolved', async () => {
    const oldSession = {
      deviceId: 'dev-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: false,
    };
    await seedAccount(oldSession);
    await AsyncStorage.setItem('private-a', 'still-owned-by-a');
    await AsyncStorage.setItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY, JSON.stringify({
      version: 1,
      operationId: '9e0c0d0e-e194-4cf8-9399-e966a7c14f00',
      fromAccountId: oldSession.accountId,
      toAccountId: null,
      preparedAt: Date.now(),
    }));
    resetPrivateAccountBoundaryForTests();
    const clearPrivateData = jest.fn(async () => {
      await AsyncStorage.removeItem('private-a');
    });

    await expect(revertToAnonymous(undefined, clearPrivateData)).rejects.toThrow(
      'Anonymous account merge is unresolved',
    );

    expect(clearPrivateData).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('private-a')).toBe('still-owned-by-a');
    expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).not.toBeNull();
    await expect(ensureAccount()).resolves.toMatchObject(oldSession);
  });

  it('clears A data before credential removal, keeps A on failure, and succeeds on retry', async () => {
    const oldSession = {
      deviceId: 'dev-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: true,
    };
    await AsyncStorage.setItem(DEVICE_ID_KEY, oldSession.deviceId);
    await seedAccount(oldSession);
    await AsyncStorage.setItem('private-a', 'kept-until-boundary');
    const clearPrivateData = jest.fn(async () => {
      // The outgoing credential must still be durable while private data is
      // invalidated. A process kill anywhere in this callback therefore boots
      // back into A, never a replacement account over stale A storage.
      const cached = JSON.parse((await SecureStore.getItemAsync(ACCOUNT_KEY)) as string);
      expect(cached).toMatchObject(oldSession);
      await AsyncStorage.removeItem('private-a');
    });
    jest
      .mocked(SecureStore.deleteItemAsync)
      .mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(
      revertToAnonymous(undefined, clearPrivateData),
    ).rejects.toThrow('Secure session removal failed');
    expect(clearPrivateData).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('private-a')).toBeNull();
    await expect(ensureAccount()).resolves.toMatchObject(oldSession);

    setBackend('https://api.example.com');
    global.fetch = mockFetchOk({ id: 'anonymous-b', token: 'token-b' }) as unknown as typeof fetch;

    await expect(revertToAnonymous(undefined, clearPrivateData)).resolves.toMatchObject({
      accountId: 'anonymous-b',
      token: 'token-b',
      authenticated: false,
    });
    expect(clearPrivateData).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem('private-a')).toBeNull();
    await expect(ensureAccount()).resolves.toMatchObject({
      accountId: 'anonymous-b',
      token: 'token-b',
      authenticated: false,
    });
  });
});

describe('clearCachedAnonymousAccount', () => {
  it('loses the eviction race to a credential boundary before deleting A', async () => {
    const oldSession = {
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: false,
    };
    await seedAccount(oldSession);

    let releaseSecureRead!: (value: string) => void;
    let markSecureReadStarted!: () => void;
    const pausedSecureRead = new Promise<string>((resolve) => {
      releaseSecureRead = resolve;
    });
    const secureReadStarted = new Promise<void>((resolve) => {
      markSecureReadStarted = resolve;
    });
    jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(async () => {
      markSecureReadStarted();
      return pausedSecureRead;
    });

    const eviction = clearCachedAnonymousAccount(oldSession, {
      source: 'test_race',
      endpoint: '/v1/test',
    });
    await secureReadStarted;

    const transition = beginPrivateAccountTransition('test-auth', oldSession.accountId);
    expect(transition).not.toBeNull();
    const drained = transition!.drain();
    releaseSecureRead(JSON.stringify(oldSession));

    await expect(eviction).resolves.toBe(false);
    await drained;
    await expect(
      preflightPrivateAccountMerge(
        transition!,
        oldSession.accountId,
        async () => true,
        () => '9e0c0d0e-e194-4cf8-9399-e966a7c14f00',
      ),
    ).resolves.toMatchObject({
      operationId: '9e0c0d0e-e194-4cf8-9399-e966a7c14f00',
    });

    expect(await SecureStore.getItemAsync(ACCOUNT_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)).not.toBeNull();
    transition!.release();
  });

  it('keeps A credential after a 401 while its merge operation is unresolved', async () => {
    const oldSession = {
      deviceId: 'device-a',
      accountId: 'account-a',
      token: 'token-a',
      authenticated: false,
    };
    await seedAccount(oldSession);
    await AsyncStorage.setItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY, JSON.stringify({
      version: 1,
      operationId: '9e0c0d0e-e194-4cf8-9399-e966a7c14f00',
      fromAccountId: 'account-a',
      toAccountId: null,
      preparedAt: Date.now(),
    }));
    resetPrivateAccountBoundaryForTests();
    const listener = jest.fn();
    setAnonymousSessionEvictionListener(listener);

    await expect(clearCachedAnonymousAccount(oldSession, {
      source: 'test',
      endpoint: '/v1/test',
    })).resolves.toBe(false);
    await expect(ensureAccount()).resolves.toMatchObject(oldSession);
    expect(listener).not.toHaveBeenCalled();
    expect(mockTrackApiFailure).toHaveBeenCalledWith(
      'anonymous_session_eviction',
      expect.objectContaining({ reason: 'anonymous_401_merge_unresolved' }),
    );
  });

  const requestContext = {
    source: 'account_preferences_fetch',
    endpoint: '/v1/account/me',
  };

  it('ignores an old anonymous 401 after an authenticated session was saved', async () => {
    await seedAccount({
      deviceId: 'dev-1',
      accountId: 'anon-1',
      token: 'old-anonymous-token',
      authenticated: false,
    });
    const oldSession = await ensureAccount();

    await setSession({
      deviceId: 'dev-1',
      accountId: 'signed-1',
      token: 'new-authenticated-token',
      authenticated: true,
    });

    await expect(clearCachedAnonymousAccount(oldSession, requestContext)).resolves.toBe(false);
    await expect(ensureAccount()).resolves.toMatchObject({
      accountId: 'signed-1',
      token: 'new-authenticated-token',
      authenticated: true,
    });
    expect(mockTrackApiFailure).toHaveBeenCalledWith('anonymous_session_eviction', {
      endpoint: '/v1/account/me',
      source: 'account_preferences_fetch',
      status: 401,
      reason: 'anonymous_401_stale_session_ignored',
    });
  });

  it('evicts the matching anonymous session and notifies the store listener', async () => {
    await seedAccount({
      deviceId: 'dev-1',
      accountId: 'anon-1',
      token: 'current-anonymous-token',
      authenticated: false,
    });
    const listener = jest.fn();
    setAnonymousSessionEvictionListener(listener);
    jest.clearAllMocks();

    await expect(
      clearCachedAnonymousAccount(
        {
          deviceId: 'dev-1',
          accountId: 'anon-1',
          token: 'current-anonymous-token',
          authenticated: false,
        },
        requestContext,
      ),
    ).resolves.toBe(true);

    expect(await SecureStore.getItemAsync(ACCOUNT_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(mockTrackApiFailure).toHaveBeenCalledWith('anonymous_session_eviction', {
      endpoint: '/v1/account/me',
      source: 'account_preferences_fetch',
      status: 401,
      reason: 'anonymous_401_current_session_evicted',
    });
    expect(mockSetTelemetrySession.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrackApiFailure.mock.invocationCallOrder[0],
    );
  });
});

describe('account preferences', () => {
  it('GETs /v1/account/me with the cached Bearer token and maps hide_pub_names', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend('https://api.example.com');
    const fetchSpy = mockFetchOk({ id: 'acc-1', device_id: 'dev-1', hide_pub_names: true });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const preferences = await fetchAccountPreferences();

    expect(preferences).toEqual({ hidePubNames: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/account/me');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('maps the backend settings block into account preferences', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend('https://api.example.com');
    global.fetch = mockFetchOk({
      id: 'acc-1',
      device_id: 'dev-1',
      settings: {
        mode: 'surprise',
        max_distance_km: 5,
        price_currency: 'EUR',
        haptic_enabled: false,
        sound_enabled: true,
        hide_closed_pubs: false,
        hide_pub_names: true,
      },
    }) as unknown as typeof fetch;

    await expect(fetchAccountPreferences()).resolves.toEqual({
      mode: 'surprise',
      maxDistanceKm: 5,
      priceCurrency: 'EUR',
      hapticEnabled: false,
      soundEnabled: true,
      hideClosedPubs: false,
      hidePubNames: true,
    });
  });

  it('PATCHes hidePubNames as hide_pub_names and returns the updated preferences', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend('https://api.example.com');
    const fetchSpy = mockFetchOk({ id: 'acc-1', device_id: 'dev-1', hide_pub_names: false });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const preferences = await updateAccountPreferences({ hidePubNames: false });

    expect(preferences).toEqual({ hidePubNames: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/account/me');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ hide_pub_names: false });
  });

  it('refuses to PATCH queued preferences under a different account', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend('https://api.example.com');
    const fetchSpy = mockFetchOk({ id: 'acc-1', device_id: 'dev-1' });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      updateAccountPreferences(
        { marketingEmailsEnabled: false },
        undefined,
        'another-account',
      ),
    ).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('PATCHes expanded preferences using the backend field names', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend('https://api.example.com');
    const fetchSpy = mockFetchOk({
      id: 'acc-1',
      device_id: 'dev-1',
      settings: {
        mode: 'nearest',
        max_distance_km: null,
        price_currency: 'CZK',
        haptic_enabled: true,
        sound_enabled: false,
        hide_closed_pubs: true,
        hide_pub_names: false,
      },
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const preferences = await updateAccountPreferences({
      mode: 'nearest',
      maxDistanceKm: null,
      priceCurrency: 'CZK',
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      hidePubNames: false,
    });

    expect(preferences).toEqual({
      mode: 'nearest',
      maxDistanceKm: null,
      priceCurrency: 'CZK',
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      hidePubNames: false,
    });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      compass_mode: 'nearest',
      max_distance_km: null,
      price_currency: 'CZK',
      haptic_enabled: true,
      sound_enabled: false,
      hide_closed_pubs: true,
      hide_pub_names: false,
    });
  });

  it('clears an anonymous cached account when preferences fetch gets a 401', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({ deviceId: 'dev-1', accountId: 'acc-1', token: 'tok-1' });
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchAccountPreferences()).resolves.toBeNull();
    expect(await SecureStore.getItemAsync(ACCOUNT_KEY)).toBeNull();
  });

  it('keeps an authenticated cached account when preferences fetch gets a 401', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'dev-1');
    await seedAccount({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'tok-1',
      authenticated: true,
    });
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchAccountPreferences()).resolves.toBeNull();
    expect(await SecureStore.getItemAsync(ACCOUNT_KEY)).not.toBeNull();
  });
});
