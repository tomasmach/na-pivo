import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  disableCachedPushDeviceWithBearer,
  PUSH_TOKEN_KEY,
  registerCachedPushDeviceWithBearer,
} from '../pushDeviceClient';

const mockGetPermissionsAsync = jest.fn();
const mockSettingsGetState = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: mockGetPermissionsAsync,
}));
jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn(() => 'https://api.test/v1/push-device'),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));
jest.mock('@/utils/appVersion', () => ({ getAppVersionLabel: () => '3.0.0' }));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: (...args: unknown[]) => mockSettingsGetState(...args) },
}));

const originalFetch = global.fetch;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockSettingsGetState.mockReturnValue({
    pubReminderEnabled: false,
    friendPushEnabled: true,
    friendPushOptedOut: false,
  });
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

it('treats a missing cached token as already disabled', async () => {
  await expect(disableCachedPushDeviceWithBearer('token-a')).resolves.toBe(true);
  expect(global.fetch).not.toHaveBeenCalled();
});

it('rebinds an opted-out token to B as disabled instead of re-enabling push', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[test]');
  mockSettingsGetState.mockReturnValue({
    pubReminderEnabled: false,
    friendPushEnabled: true,
    friendPushOptedOut: true,
  });

  await expect(registerCachedPushDeviceWithBearer('token-b')).resolves.toBe(true);

  const [, init] = jest.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-b');
  expect(JSON.parse(init.body as string)).toMatchObject({
    push_token: 'ExponentPushToken[test]',
    permission_status: 'granted',
    enabled: false,
  });
});

it('rebinds a token with revoked OS permission as denied and disabled', async () => {
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[test]');
  mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });

  await expect(registerCachedPushDeviceWithBearer('token-b')).resolves.toBe(true);

  const [, init] = jest.mocked(global.fetch).mock.calls[0] as [string, RequestInit];
  expect(JSON.parse(init.body as string)).toMatchObject({
    permission_status: 'denied',
    enabled: false,
  });
});
