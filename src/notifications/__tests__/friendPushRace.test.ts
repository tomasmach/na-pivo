import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { disableFriendPush, ensureFriendPushRegisteredIfGranted, registerFriendPush } from '../friendPush';
import { useSettingsStore } from '@/stores/settingsStore';
import { disableCachedPushDeviceWithBearer, PUSH_TOKEN_KEY } from '@/data/pushDeviceClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[synthetic-race]' })),
}));
jest.mock('@/data/account', () => ({
  ensureAccount: async () => ({ token: 'synthetic-local-account' }),
  clearCachedAnonymousAccount: jest.fn(),
}));
jest.mock('@/data/backendConfig', () => ({ getBackendEndpoint: () => 'http://127.0.0.1:19999/v1/push-device' }));
jest.mock('@/data/telemetryClient', () => ({ trackApiFailure: jest.fn() }));
jest.mock('@/utils/appVersion', () => ({ getAppVersionLabel: () => 'test' }));

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const originalFetch = global.fetch;
let serverParta: boolean;
let requests: string[];

function requestKind(init?: RequestInit): string {
  if (init?.method !== 'PUT') return init?.method ?? '';
  const friendPush = JSON.parse(init.body as string).friend_push;
  return friendPush === true ? 'PUT on' : friendPush === false ? 'PUT off' : 'PUT without friend_push';
}
function apply(init?: RequestInit): void {
  serverParta = requestKind(init) === 'PUT on';
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await useSettingsStore.persist.rehydrate();
  useSettingsStore.setState({ friendPushEnabled: true, friendPushOptedOut: false });
  serverParta = true;
  requests = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(requestKind(init));
    apply(init);
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  }) as typeof fetch;
});
afterEach(() => { global.fetch = originalFetch; });

it.each(['silent', 'explicit'] as const)('keeps the server and persisted choice off after a delayed %s registration', async (mode) => {
  let finishPut!: () => void;
  jest.mocked(global.fetch).mockImplementationOnce(async (_url, init) => {
    requests.push(`${requestKind(init)} started`);
    await new Promise<void>((resolve) => { finishPut = resolve; });
    apply(init);
    requests.push(`${requestKind(init)} applied`);
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  const registration = mode === 'silent' ? ensureFriendPushRegisteredIfGranted() : registerFriendPush();
  await settle();
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  const disabling = disableFriendPush();
  await settle();
  finishPut();
  await Promise.all([registration, disabling]);
  expect(serverParta).toBe(false);
  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(true);
  expect(requests).toEqual(['PUT on started', 'PUT on applied', 'PUT off']);
  const persisted = JSON.parse((await AsyncStorage.getItem('na-pivo-settings'))!);
  expect(persisted.state.friendPushOptedOut).toBe(true);
});

it('also disables a token that was not acquired until after the opt-out', async () => {
  let finishToken!: (token: { data: string; type: 'expo' }) => void;
  jest.mocked(Notifications.getExpoPushTokenAsync).mockReturnValueOnce(new Promise((resolve) => { finishToken = resolve; }));
  const registration = ensureFriendPushRegisteredIfGranted();
  await settle();
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  const disabling = disableFriendPush();
  await settle();
  finishToken({ data: 'ExponentPushToken[synthetic-late]', type: 'expo' });
  await Promise.all([registration, disabling]);
  expect(serverParta).toBe(false);
  expect(requests.at(-1)).toBe('PUT off');
  expect(requests).not.toContain('DELETE');
});

it('retries an offline opt-out on focus using the persisted choice', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[synthetic-race]');
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  await expect(disableFriendPush()).resolves.toBe(false);
  await useSettingsStore.persist.rehydrate();
  await ensureFriendPushRegisteredIfGranted();
  expect(requests).toEqual(['PUT off']);
  expect(serverParta).toBe(false);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(true);
});

it('lets a later explicit enable win over an in-flight disable', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[synthetic-race]');
  let finishOptOut!: () => void;
  jest.mocked(global.fetch).mockImplementationOnce(async (_url, init) => {
    requests.push(`${requestKind(init)} started`);
    await new Promise<void>((resolve) => { finishOptOut = resolve; });
    apply(init);
    requests.push(`${requestKind(init)} applied`);
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  const disabling = disableFriendPush();
  await settle();
  const registration = registerFriendPush();
  await settle();
  finishOptOut();
  await Promise.all([disabling, registration]);
  expect(serverParta).toBe(true);
  expect(useSettingsStore.getState().friendPushEnabled).toBe(true);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(false);
  expect(requests).toEqual(['PUT off started', 'PUT off applied', 'PUT on']);
});

it('waits for the saved opt-out before doing any startup registration', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[synthetic-race]');
  const storedSettings = JSON.stringify({ state: { friendPushEnabled: false, friendPushOptedOut: true }, version: 1 });
  let finishHydration!: (value: string) => void;
  const hydration = new Promise<string>((resolve) => { finishHydration = resolve; });
  const getItem = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
  const storageRead = jest.spyOn(AsyncStorage, 'getItem').mockImplementation((key) =>
    key === 'na-pivo-settings' ? hydration : getItem(key));
  try {
    const restoring = useSettingsStore.persist.rehydrate();
    const registration = ensureFriendPushRegisteredIfGranted();
    await settle();
    expect(requests).toEqual([]);
    finishHydration(storedSettings);
    await Promise.all([restoring, registration]);
    expect(requests).toEqual(['PUT off']);
    expect(serverParta).toBe(false);
  } finally {
    storageRead.mockImplementation(getItem);
  }
});

it('persists increasing server revisions even when the device clock moves backwards', async () => {
  await AsyncStorage.setItem('na-pivo-push-device-revision', '9000');
  const clock = jest.spyOn(Date, 'now').mockReturnValue(8000);
  try {
    await registerFriendPush();
    await disableFriendPush();
    const bodies = jest.mocked(global.fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies.map((body) => body.client_revision)).toEqual([9001, 9002]);
    expect(await AsyncStorage.getItem('na-pivo-push-device-revision')).toBe('9002');
  } finally {
    clock.mockRestore();
  }
});

it('does not report success when a stale registration was ignored by the server', async () => {
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ applied: false }) } as Response);
  await expect(registerFriendPush()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(true);
});

it('does not touch the server on opt-out without permission', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[synthetic-race]');
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({
    status: 'denied',
  } as Notifications.NotificationPermissionsStatus);
  await expect(disableFriendPush()).resolves.toBe(true);
  expect(requests).toEqual([]);
});

it('still disables the whole device with DELETE on logout', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[synthetic-race]');
  await expect(disableCachedPushDeviceWithBearer('synthetic-bearer')).resolves.toBe(true);
  expect(requests).toEqual(['DELETE']);
  const [, init] = jest.mocked(global.fetch).mock.calls[0];
  expect(JSON.parse(init!.body as string)).toEqual({
    push_token: 'ExponentPushToken[synthetic-race]',
    client_revision: expect.any(Number),
  });
});
