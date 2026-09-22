import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { disableFriendPush, ensureFriendPushRegisteredIfGranted, registerFriendPush } from '../friendPush';
import { useSettingsStore } from '@/stores/settingsStore';
import { PUSH_TOKEN_KEY } from '@/data/pushDeviceClient';

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
let serverEnabled: boolean;
let requests: string[];

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await useSettingsStore.persist.rehydrate();
  useSettingsStore.setState({ friendPushEnabled: true, friendPushOptedOut: false });
  serverEnabled = true;
  requests = [];
  global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const method = init?.method ?? '';
    requests.push(method);
    serverEnabled = method === 'PUT';
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
});
afterEach(() => { global.fetch = originalFetch; });

it.each(['silent', 'explicit'] as const)('keeps the server and persisted choice off after a delayed %s registration', async (mode) => {
  let finishPut!: () => void;
  jest.mocked(global.fetch).mockImplementationOnce(async () => {
    requests.push('PUT started');
    await new Promise<void>((resolve) => { finishPut = resolve; });
    serverEnabled = true;
    requests.push('PUT applied');
    return { ok: true, status: 200 } as Response;
  });
  const registration = mode === 'silent' ? ensureFriendPushRegisteredIfGranted() : registerFriendPush();
  await settle();
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  const disabling = disableFriendPush();
  await settle();
  finishPut();
  await Promise.all([registration, disabling]);
  expect(serverEnabled).toBe(false);
  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(true);
  expect(requests).toEqual(['PUT started', 'PUT applied', 'DELETE']);
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
  expect(serverEnabled).toBe(false);
  expect(requests.at(-1)).toBe('DELETE');
});

it('retries an offline opt-out on focus using the persisted choice', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[synthetic-race]');
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  await expect(disableFriendPush()).resolves.toBe(false);
  await useSettingsStore.persist.rehydrate();
  await ensureFriendPushRegisteredIfGranted();
  expect(requests).toEqual(['DELETE']);
  expect(serverEnabled).toBe(false);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(true);
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

it('lets a later explicit enable win over an in-flight disable', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[synthetic-race]');
  let finishDelete!: () => void;
  jest.mocked(global.fetch).mockImplementationOnce(async () => {
    requests.push('DELETE started');
    await new Promise<void>((resolve) => { finishDelete = resolve; });
    serverEnabled = false;
    requests.push('DELETE applied');
    return { ok: true, status: 200 } as Response;
  });
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });
  const disabling = disableFriendPush();
  await settle();
  const registration = registerFriendPush();
  await settle();
  finishDelete();
  await Promise.all([disabling, registration]);
  expect(serverEnabled).toBe(true);
  expect(useSettingsStore.getState().friendPushEnabled).toBe(true);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(false);
  expect(requests).toEqual(['DELETE started', 'DELETE applied', 'PUT']);
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
    expect(requests).toEqual(['DELETE']);
    expect(serverEnabled).toBe(false);
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  } finally {
    storageRead.mockRestore();
  }
});
