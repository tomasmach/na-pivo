/**
 * Shared Expo push-token acquisition + device registration.
 *
 * Both notification features register the same device token, so the token dance
 * (getExpoPushTokenAsync → persist → registerPushDevice) lives here once:
 *   - pub reminders call it after the geofence permission gate (unchanged),
 *   - Parta calls it after its notification-only opt-in (Parta 3.0 §E / §8.5),
 *     fully independent of background location.
 *
 * Best-effort and never throws — a missing native module or offline backend just
 * means push stays dark until the next attempt.
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
    void registerPushDevice(token, status);
    return token;
  } catch {
    return null;
  }
}
