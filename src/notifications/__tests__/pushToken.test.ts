import AsyncStorage from '@react-native-async-storage/async-storage';

import { ensurePushTokenRegistered } from '../pushToken';

const mockRegisterPushDevice = jest.fn<Promise<boolean>, [string, string]>();

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
}));

jest.mock('@/data/pushDeviceClient', () => ({
  PUSH_TOKEN_KEY: 'na-pivo-expo-push-token',
  registerPushDevice: (token: string, status: string) => mockRegisterPushDevice(token, status),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockRegisterPushDevice.mockResolvedValue(true);
});

it('does not report a token as registered when the backend rejects it', async () => {
  mockRegisterPushDevice.mockResolvedValue(false);

  await expect(ensurePushTokenRegistered('granted')).resolves.toBeNull();
});

it('waits for backend acceptance before reporting successful registration', async () => {
  let accept!: (accepted: boolean) => void;
  mockRegisterPushDevice.mockImplementation(() => new Promise((resolve) => {
    accept = resolve;
  }));
  const completed = jest.fn();

  const registration = ensurePushTokenRegistered('granted').then((token) => {
    completed(token);
    return token;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  expect(mockRegisterPushDevice).toHaveBeenCalledWith('ExponentPushToken[test]', 'granted');
  expect(completed).not.toHaveBeenCalled();
  accept(true);
  await expect(registration).resolves.toBe('ExponentPushToken[test]');
});

it('retries a previously saved token after the backend recovers', async () => {
  mockRegisterPushDevice.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

  await expect(ensurePushTokenRegistered('granted')).resolves.toBeNull();
  expect(await AsyncStorage.getItem('na-pivo-expo-push-token')).toBe('ExponentPushToken[test]');
  await expect(ensurePushTokenRegistered('granted')).resolves.toBe('ExponentPushToken[test]');

  expect(mockRegisterPushDevice).toHaveBeenCalledTimes(2);
});
