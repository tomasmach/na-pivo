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

import { useSettingsStore } from '@/stores/settingsStore';
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
  | { ok: false; reason: 'denied' | 'unavailable' };

/**
 * Prompt for notification permission (not location), register the push token,
 * and persist the opt-in state. Marks the prompt as shown either way so the
 * strip never re-nags. Returns whether push ended up enabled.
 */
export async function registerFriendPush(): Promise<FriendPushResult> {
  const { setFriendPushEnabled, setFriendPushPrompted, setFriendPushOptedOut } =
    useSettingsStore.getState();
  setFriendPushPrompted(true);

  if (!Notifications) {
    setFriendPushEnabled(false);
    return { ok: false, reason: 'unavailable' };
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status === 'undetermined') {
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: false },
    });
    status = requested.status;
  }

  if (status !== 'granted') {
    setFriendPushEnabled(false);
    return { ok: false, reason: 'denied' };
  }

  await ensurePushTokenRegistered('granted');
  // An explicit enable clears any prior opt-out so the launch/focus re-register
  // keeps push on (and re-enables the device server-side via the token register).
  setFriendPushOptedOut(false);
  setFriendPushEnabled(true);
  return { ok: true };
}

/**
 * Stop Parta push delivery when the user turns the toggle off (§E3). The backend
 * fanout gates only on the device being enabled + permission-granted, so we
 * disable THIS device server-side; the persisted opt-out flag (set by the caller)
 * then keeps the launch/focus re-register from turning it back on. Best-effort —
 * returns whether the server accepted the disable so the caller can revert on fail.
 *
 * Note: this disables the whole device, so an active pub-reminder subscription is
 * paused until its own next register. That is an accepted tradeoff — the backend
 * has no per-category push preference, and pub reminders and Parta push are rarely
 * both on for the same user.
 */
export async function disableFriendPush(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    // No registered token → nothing is delivering; treat the opt-out as applied.
    if (!token) return true;
    return await disablePushDevice(token);
  } catch {
    return false;
  }
}

/**
 * Silent opportunistic register: if notification permission is already granted,
 * refresh the device token so existing grantees receive Parta pushes without a
 * prompt. Safe to call on launch and on Parta focus.
 */
export async function ensureFriendPushRegisteredIfGranted(): Promise<void> {
  if (!Notifications) return;
  // Respect an explicit opt-out: once the user turned Parta notifications off we
  // must never silently re-register the device or force the toggle back on (§E3).
  if (useSettingsStore.getState().friendPushOptedOut) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    await ensurePushTokenRegistered('granted');
    if (!useSettingsStore.getState().friendPushEnabled) {
      useSettingsStore.getState().setFriendPushEnabled(true);
    }
  } catch {
    // Permission API unavailable — leave push state untouched.
  }
}
