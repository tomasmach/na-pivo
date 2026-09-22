import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import {
  disableFriendPush,
  ensureFriendPushRegisteredIfGranted,
  registerFriendPush,
} from '../friendPush';
import { useSettingsStore } from '@/stores/settingsStore';

const mockEnsurePushTokenRegistered = jest.fn<Promise<string | null>, []>(
  async () => 'ExponentPushToken[test]',
);
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

beforeEach(async () => {
  jest.clearAllMocks();
  mockEnsurePushTokenRegistered.mockResolvedValue('ExponentPushToken[test]');
  mockDisablePushDevice.mockResolvedValue(true);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    status: 'granted',
  } as Notifications.NotificationPermissionsStatus);
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

  expect(mockEnsurePushTokenRegistered).toHaveBeenCalledWith('granted', { reuseRecent: true });
  expect(useSettingsStore.getState().friendPushEnabled).toBe(true);
});

it('keeps a later opt-out after an in-flight registration resolves', async () => {
  let finishRegistration!: (token: string) => void;
  mockEnsurePushTokenRegistered.mockReturnValue(new Promise((resolve) => { finishRegistration = resolve; }));
  const registration = ensureFriendPushRegisteredIfGranted();
  await Promise.resolve();
  useSettingsStore.setState({ friendPushOptedOut: true, friendPushEnabled: false });
  finishRegistration('ExponentPushToken[test]');
  await registration;
  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
});

it('does not register after opting out while permission is being checked', async () => {
  let finishPermission!: (status: Notifications.NotificationPermissionsStatus) => void;
  jest.mocked(Notifications.getPermissionsAsync).mockReturnValueOnce(new Promise((resolve) => { finishPermission = resolve; }));
  const registration = ensureFriendPushRegisteredIfGranted();
  useSettingsStore.setState({ friendPushOptedOut: true, friendPushEnabled: false });
  finishPermission({ status: 'granted' } as Notifications.NotificationPermissionsStatus);
  await registration;
  expect(mockEnsurePushTokenRegistered).not.toHaveBeenCalled();
});

it('clears the opt-out on an explicit enable', async () => {
  useSettingsStore.setState({ friendPushOptedOut: true, friendPushEnabled: false });

  const result = await registerFriendPush();

  expect(result).toEqual({ ok: true });
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(false);
  expect(useSettingsStore.getState().friendPushEnabled).toBe(true);
});

it('keeps push off when device registration fails', async () => {
  useSettingsStore.setState({ friendPushOptedOut: true });
  mockEnsurePushTokenRegistered.mockResolvedValue(null);

  await expect(registerFriendPush()).resolves.toEqual({ ok: false, reason: 'unavailable' });

  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
  expect(useSettingsStore.getState().friendPushOptedOut).toBe(true);
});

it('does not enable push after a failed silent registration', async () => {
  mockEnsurePushTokenRegistered.mockResolvedValue(null);

  await ensureFriendPushRegisteredIfGranted();

  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
});

it('preserves an existing registration during a failed refresh', async () => {
  useSettingsStore.setState({ friendPushEnabled: true });
  mockEnsurePushTokenRegistered.mockResolvedValue(null);

  await ensureFriendPushRegisteredIfGranted();

  expect(useSettingsStore.getState().friendPushEnabled).toBe(true);
});

it('returns a retryable failure if the permission API throws', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockRejectedValueOnce(new Error('Unavailable'));

  await expect(registerFriendPush()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  expect(useSettingsStore.getState().friendPushEnabled).toBe(false);
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
