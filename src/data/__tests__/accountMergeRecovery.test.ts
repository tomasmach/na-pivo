import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { clearCachedAccount, clearCachedAnonymousAccount, ensureAccount, setSession } from '../account';
import { loginEmail, registerEmail, signInWithGoogle, signInWithApple, logout, resetPassword } from '../auth';
import { readAccountMerge } from '../accountMerge';
import { flushDrinksQueue } from '../drinksQueue';
import { clearLocalPrivateAccountData } from '../privateAccountData';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}` }));
jest.mock('../socialAuth', () => ({ SocialAuthError: class extends Error {}, getGoogleIdToken: async () => 'test-google', getAppleCredential: async () => ({ identityToken: 'test-apple' }) }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn(), trackClientEvent: jest.fn(), setTelemetrySession: jest.fn() }));
jest.mock('../pushDeviceClient', () => ({ disableCachedPushDeviceWithBearer: jest.fn() }));
jest.mock('../pivarXp', () => ({ notePivarSnapshot: jest.fn() }));
jest.mock('../privateAccountData', () => ({ clearLocalPrivateAccountData: jest.fn() }));

const KEY = 'na-pivo-party-games-account-merge';
const LEGACY_KEY = 'na-pivo-private-account-merge-v0';
const source = { deviceId: 'device-a', accountId: 'a', token: 'token-a', authenticated: false };
const intent = { version: 1, operationId: 'd03f32ea-54df-47a7-bc32-a6b479f00a89', fromAccountId: 'a', toAccountId: null, preparedAt: 1 };
const target = { id: 'b', token: 'token-b', device_id: 'device-b', is_anonymous: false };
const drink = { client_id: 'pending-drink', place_context: 'private', beer: { name: 'Test', volume_ml: 500 }, drank_at: '2026-09-15T17:00:00Z' };
const realFetch = global.fetch;
function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await clearCachedAccount();
  await setSession(source);
  global.fetch = jest.fn(async () => response(401, {}));
});
afterEach(() => { global.fetch = realFetch; });

it.each([KEY, LEGACY_KEY])('retains the source after a lost 2.0 claim, replays proof and delivers only to B (%s)', async (key) => {
  await AsyncStorage.setItem(key, JSON.stringify(intent));
  await AsyncStorage.setItem('na-pivo-drinks-queue', JSON.stringify([drink]));
  // The server already merged A into B and revoked A. Do not mint C on 401.
  await flushDrinksQueue();
  expect((await ensureAccount())?.accountId).toBe('a');
  expect(JSON.parse((await AsyncStorage.getItem('na-pivo-drinks-queue'))!)).toHaveLength(1);
  expect(jest.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/v1/drinks'))).toBe(true);
  global.fetch = jest.fn(async (url, init) => {
    if (String(url).endsWith('/v1/auth/login')) {
      expect(JSON.parse(init!.body as string).merge_operation_id).toBe(intent.operationId);
      return response(200, target);
    }
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer token-b');
    return response(201, {});
  });
  expect((await loginEmail({ email: 'test@example.invalid', password: 'test' })).ok).toBe(true);
  await flushDrinksQueue();
  expect((await ensureAccount())?.accountId).toBe('b');
  expect(await AsyncStorage.getItem('na-pivo-drinks-queue')).toBeNull();
  expect(await readAccountMerge()).toEqual({ ok: true, intent: null });
});

it('does not bootstrap C when the source bearer is missing', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify(intent));
  await clearCachedAccount();
  expect(await ensureAccount()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['{bad', JSON.stringify({ version: 9 })])('keeps the source when a marker is unreadable (%s)', async (raw) => {
  await AsyncStorage.setItem(KEY, raw);
  expect(await clearCachedAnonymousAccount(source, { source: 'test', endpoint: '/v1/drinks' })).toBe(false);
  expect((await ensureAccount())?.accountId).toBe('a');
  expect((await loginEmail({ email: 'test@example.invalid', password: 'test' })).ok).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps proof after a replay with invalid credentials and blocks destructive session changes', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify(intent));
  expect((await loginEmail({ email: 'test@example.invalid', password: 'wrong' })).ok).toBe(false);
  expect(await AsyncStorage.getItem(KEY)).not.toBeNull();
  expect((await logout()).ok).toBe(false);
  expect((await resetPassword({ token: 'reset', password: 'other' })).ok).toBe(false);
  expect(clearLocalPrivateAccountData).not.toHaveBeenCalled();
});

it.each([
  () => loginEmail({ email: 'test@example.invalid', password: 'test' }),
  () => registerEmail({ email: 'test@example.invalid', password: 'test' }),
  () => signInWithGoogle(),
  () => signInWithApple(),
])('persists a fresh operation before auth and reuses it after response loss (%#)', async (signIn) => {
  let operationId: string | undefined;
  global.fetch = jest.fn(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    const marker = JSON.parse((await AsyncStorage.getItem(KEY))!);
    expect(body.merge_operation_id).toBe(marker.operationId);
    if (!operationId) {
      operationId = body.merge_operation_id;
      throw new Error('Lost success response');
    }
    expect(body.merge_operation_id).toBe(operationId);
    return response(200, target);
  });
  expect((await signIn()).ok).toBe(false);
  expect(await clearCachedAnonymousAccount(source, { source: 'test', endpoint: '/v1/drinks' })).toBe(false);
  expect((await signIn()).ok).toBe(true);
  expect(await readAccountMerge()).toEqual({ ok: true, intent: null });
});

it('cancels only a newly created, definitively rejected claim', async () => {
  expect((await loginEmail({ email: 'test@example.invalid', password: 'wrong' })).ok).toBe(false);
  expect(await readAccountMerge()).toEqual({ ok: true, intent: null });
});

it('recovers after the target session was saved but marker cleanup was interrupted', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...intent, toAccountId: 'b' }));
  await setSession({ deviceId: 'device-b', accountId: 'b', token: 'token-b', authenticated: true });
  expect((await ensureAccount())?.accountId).toBe('b');
  expect(await readAccountMerge()).toEqual({ ok: true, intent: null });
  expect(fetch).not.toHaveBeenCalled();
});

it('retains the source and bound operation if secure storage rejects the new bearer', async () => {
  await AsyncStorage.setItem(KEY, JSON.stringify(intent));
  global.fetch = jest.fn(async () => response(200, target));
  jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValueOnce(new Error('Keychain locked'));
  expect((await loginEmail({ email: 'test@example.invalid', password: 'test' })).ok).toBe(false);
  expect((await ensureAccount())?.accountId).toBe('a');
  expect(await readAccountMerge()).toMatchObject({ ok: true, intent: { toAccountId: 'b' } });
});
