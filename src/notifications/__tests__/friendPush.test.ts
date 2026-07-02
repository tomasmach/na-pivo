import AsyncStorage from '@react-native-async-storage/async-storage';

const mockEnsurePushTokenRegistered = jest.fn(async () => 'ExponentPushToken[test]');
const mockDisablePushDevice = jest.fn(async () => true);

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));

jest.mock('@/notifications/pushToken', () => ({
  ensurePushTokenRegistered: (...a: unknown[]) => mockEnsurePushTokenRegistered(...(a as [])),
}));

jest.mock('@/data/pushDeviceClient', () => ({
  PUSH_TOKEN_KEY: 'na-pivo-expo-push-token',
  disablePushDevice: (...a: unknown[]) => mockDisablePushDevice(...(a as [])),
}));

import {
  disableFriendPush,
  ensureFriendPushRegisteredIfGranted,
  registerFriendPush,
} from '../friendPush';
import { useSettingsStore } from '@/stores/settingsStore';

beforeEach(async () => {
  jest.clearAllMocks();
  mockEnsurePushTokenRegistered.mockResolvedValue('ExponentPushToken[test]');
  mockDisablePushDevice.mockResolvedValue(true);
  await AsyncStorage.clear();
  useSettingsStore.setState({
    friendPushEnabled: false,
    friendPushPrompted: false,
    friendPushOptedOut: false,
  });
});

it('does not force the toggle back on when the user has opted out', async () => {
  // The user turned Parta notifications off: toggle off + explicit opt-out.
  useSettingsStore.setState({ friendPushEnabled: false, friendPushOptedOut: true });

  await ensureFriendPushRegisteredIfGranted();

  // The launch/focus re-register must respect the opt-out — no re-register, no flip.
  expect(mockEnsurePushTokenRegistered).not.toHaveBeenCalled();
  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
});

it('lights up push for an existing grantee who has not opted out', async () => {
  await ensureFriendPushRegisteredIfGranted();

  expect(mockEnsurePushTokenRegistered).toHaveBeenCalledWith('granted');
  expect(useSettingsStore.getState().friendPushEnabled).toBe(true);
});

it('clears the opt-out on an explicit enable', async () => {
  useSettingsStore.setState({ friendPushOptedOut: true, friendPushEnabled: false });

  const result = await registerFriendPush();

  expect(result).toEqual({ ok: true });
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(false);
  expect(useSettingsStore.getState().friendPushEnabled).toBe(true);
});

it('disables the device server-side on toggle-off', async () => {
  await AsyncStorage.setItem('na-pivo-expo-push-token', 'ExponentPushToken[test]');

  await expect(disableFriendPush()).resolves.toBe(true);
  expect(mockDisablePushDevice).toHaveBeenCalledWith('ExponentPushToken[test]');
});

it('treats a missing token as already-disabled without a server call', async () => {
  await expect(disableFriendPush()).resolves.toBe(true);
  expect(mockDisablePushDevice).not.toHaveBeenCalled();
});
