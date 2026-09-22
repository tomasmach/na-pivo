/**
 * Parta push opt-in — fully decoupled from pub reminders (Parta 3.0 §E / §8.5).
 *
 * Pub reminders gate push behind background-location; Parta only ever needs the
 * OS notification permission. `registerFriendPush()` requests notifications ONLY
 * (never location), registers the device token, and records the choice in the
 * settings store so the in-context opt-in strip can react. Existing grantees are
 * lit up silently via `ensureFriendPushRegisteredIfGranted()` on launch / focus.
 *
 * Best-effort and never throws.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as ExpoNotifications from 'expo-notifications';

import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { disablePushDevice, PUSH_TOKEN_KEY } from '@/data/pushDeviceClient';
import { ensurePushTokenRegistered } from '@/notifications/pushToken';

type NotificationsModule = typeof ExpoNotifications;

function loadNotifications(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();

export type FriendPushResult =
  | { ok: true }
  | { ok: false; reason: 'denied' | 'unavailable' | 'cancelled' };

// A DELETE must follow every earlier registration, including token acquisition.
// Cancelling fetch is insufficient: the server may already be applying its PUT.
let pendingChange: Promise<unknown> = Promise.resolve();
let choiceVersion = 0;

function inOrder<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingChange.then(operation);
  pendingChange = result.catch(() => undefined);
  return result;
}

async function disableCachedDevice(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    return token ? await disablePushDevice(token) : true;
  } catch {
    return false;
  }
}

/** Request notification permission and confirm the latest opt-in on the server. */
export function registerFriendPush(): Promise<FriendPushResult> {
  const version = ++choiceVersion;
  return inOrder(async () => {
    await waitForSettingsHydration();
    const isCurrent = () => version === choiceVersion;
    if (!isCurrent()) return { ok: false, reason: 'cancelled' };
    const { setFriendPushEnabled, setFriendPushPrompted, setFriendPushOptedOut } =
      useSettingsStore.getState();
    setFriendPushPrompted(true);

    try {
      if (Notifications) {
        const existing = await Notifications.getPermissionsAsync();
        if (!isCurrent()) return { ok: false, reason: 'cancelled' };
        let status = existing.status;
        if (status === 'undetermined') {
          const requested = await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: false, allowSound: false },
          });
          status = requested.status;
        }
        if (!isCurrent()) return { ok: false, reason: 'cancelled' };
        if (status !== 'granted') {
          setFriendPushEnabled(false);
          return { ok: false, reason: 'denied' };
        }
        const token = await ensurePushTokenRegistered('granted');
        if (!isCurrent()) return { ok: false, reason: 'cancelled' };
        if (token) {
          setFriendPushOptedOut(false);
          setFriendPushEnabled(true);
          return { ok: true };
        }
      }
    } catch {
      // Native permission APIs can be unavailable in an incompatible client.
    }
    if (!isCurrent()) return { ok: false, reason: 'cancelled' };
    setFriendPushEnabled(false);
    return { ok: false, reason: 'unavailable' };
  });
}

/**
 * Persist the opt-out and disable this device after earlier registrations finish.
 * Keep the choice on failure so launch/focus/foreground can retry it. The shared
 * device token also pauses pub reminders until their next explicit registration.
 */
export function disableFriendPush(): Promise<boolean> {
  ++choiceVersion;
  // The settings UI is already hydrated. Persist immediately, before a possible
  // background/termination while waiting for an older network request.
  useSettingsStore.getState().setFriendPushEnabled(false);
  useSettingsStore.getState().setFriendPushOptedOut(true);
  return inOrder(disableCachedDevice);
}

/** Reconcile the persisted choice on launch, Parta focus and app foreground. */
export function ensureFriendPushRegisteredIfGranted(): Promise<void> {
  const version = choiceVersion;
  return inOrder(async () => {
    await waitForSettingsHydration();
    if (version !== choiceVersion) return;
    if (useSettingsStore.getState().friendPushOptedOut) {
      await disableCachedDevice();
      return;
    }
    if (!Notifications) return;
    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted' || version !== choiceVersion || useSettingsStore.getState().friendPushOptedOut) return;
      const token = await ensurePushTokenRegistered('granted');
      if (token && version === choiceVersion && !useSettingsStore.getState().friendPushOptedOut) {
        useSettingsStore.getState().setFriendPushEnabled(true);
      }
    } catch {
      // Permission API unavailable — leave push state untouched.
    }
  });
}
