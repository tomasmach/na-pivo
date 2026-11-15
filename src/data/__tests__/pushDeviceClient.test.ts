import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  PUSH_TOKEN_KEY,
  disableCachedPushDeviceWithBearer,
  pushDeviceRegisteredRecently,
  registerPushDevice,
} from '../pushDeviceClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let mockAccountId = 'account-a';
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ deviceId: 'device', accountId: mockAccountId, token: 'bearer' })),
  clearCachedAnonymousAccount: jest.fn(),
}));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

beforeEach(async () => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  mockAccountId = 'account-a';
  await AsyncStorage.clear();
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, 'ExponentPushToken[device]');
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ applied: true }) })) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
});

it('remembers a registration only for the same token, account and Parta choice', async () => {
  expect(await pushDeviceRegisteredRecently()).toBe(false);

  await registerPushDevice('ExponentPushToken[device]', 'granted', undefined, true);
  expect(await pushDeviceRegisteredRecently(true)).toBe(true);
  expect(await pushDeviceRegisteredRecently(false)).toBe(false);

  mockAccountId = 'account-b';
  expect(await pushDeviceRegisteredRecently(true)).toBe(false);
});

it('forgets the registration when the device is disabled at sign-out', async () => {
  await registerPushDevice('ExponentPushToken[device]', 'granted', undefined, true);

  await disableCachedPushDeviceWithBearer('bearer');

  expect(await pushDeviceRegisteredRecently(true)).toBe(false);
});
