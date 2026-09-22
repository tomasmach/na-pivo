import AsyncStorage from '@react-native-async-storage/async-storage';

import { ensureAccount } from '../account';
import { disablePushDevice, registerPushDevice } from '../pushDeviceClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/i18n', () => ({ locale: 'cs' }));

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
}));

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `http://localhost:8012${path}`,
}));

jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

jest.mock('@/utils/appVersion', () => ({ getAppVersionLabel: () => '2.1.0 (1)' }));

const fetchMock = jest.fn();
const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

function putCalls(): unknown[] {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit).method === 'PUT');
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.spyOn(Date, 'now').mockReturnValue(T0);
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ applied: true }),
  }));
  (ensureAccount as jest.Mock).mockResolvedValue({ accountId: 'acc-1', token: 'tok' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('skips a background PUT the backend already accepted today', async () => {
  await expect(registerPushDevice('ExpoToken[a]', 'granted')).resolves.toBe(true);
  await expect(
    registerPushDevice('ExpoToken[a]', 'granted', undefined, { reuseRecent: true }),
  ).resolves.toBe(true);

  expect(putCalls()).toHaveLength(1);
});

it('sends the PUT again for a new token, account or after a day', async () => {
  await registerPushDevice('ExpoToken[a]', 'granted');

  await registerPushDevice('ExpoToken[b]', 'granted', undefined, { reuseRecent: true });
  expect(putCalls()).toHaveLength(2);

  (ensureAccount as jest.Mock).mockResolvedValue({ accountId: 'acc-2', token: 'tok2' });
  await registerPushDevice('ExpoToken[b]', 'granted', undefined, { reuseRecent: true });
  expect(putCalls()).toHaveLength(3);

  (Date.now as jest.Mock).mockReturnValue(T0 + DAY_MS);
  await registerPushDevice('ExpoToken[b]', 'granted', undefined, { reuseRecent: true });
  expect(putCalls()).toHaveLength(4);
});

it('always sends an explicit PUT and forgets the record after a disable', async () => {
  await registerPushDevice('ExpoToken[a]', 'granted');
  await registerPushDevice('ExpoToken[a]', 'granted');
  expect(putCalls()).toHaveLength(2);

  await expect(disablePushDevice('ExpoToken[a]')).resolves.toBe(true);
  await registerPushDevice('ExpoToken[a]', 'granted', undefined, { reuseRecent: true });
  expect(putCalls()).toHaveLength(3);
});

it('does not remember a registration the backend rejected', async () => {
  fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await expect(registerPushDevice('ExpoToken[a]', 'granted')).resolves.toBe(false);
  await registerPushDevice('ExpoToken[a]', 'granted', undefined, { reuseRecent: true });

  expect(putCalls()).toHaveLength(2);
});
