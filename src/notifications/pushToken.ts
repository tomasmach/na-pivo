/**
 * Expo push-token acquisition and device registration for Parta notifications.
 * Pub reminders are scheduled locally and do not use the remote device token.
 * Best-effort and never throws; offline registration can be retried later.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type * as ExpoNotifications from 'expo-notifications';

import { PUSH_TOKEN_KEY, registerPushDevice, type PushPermissionStatus } from '@/data/pushDeviceClient';

type NotificationsModule = typeof ExpoNotifications;

function loadNotifications(): NotificationsModule | null {
  try {
    // Some local dev builds miss ExpoPushTokenManager even with the JS package
    // present; degrade to a no-op instead of crashing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();

/**
 * Fetch the Expo push token (when permission is granted), persist it, and upsert
 * the device on the backend. Returns the token, or null when unavailable. No-ops
 * unless `status === 'granted'`.
 */
export async function ensurePushTokenRegistered(status: PushPermissionStatus): Promise<string | null> {
  if (status !== 'granted' || !Notifications) return null;
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const response = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = response.data;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    const registered = await registerPushDevice(token, status);
    return registered ? token : null;
  } catch {
    return null;
  }
}
