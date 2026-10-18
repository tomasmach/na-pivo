/**
 * Parta push opt-in — fully decoupled from pub reminders (Parta 3.0 §E / §8.5).
 *
 * Pub reminders are scheduled locally; Parta only ever needs the
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
import { PUSH_TOKEN_KEY } from '@/data/pushDeviceClient';
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

// An opt-out must follow every earlier registration, including token acquisition.
// Cancelling fetch is insufficient: the server may already be applying its PUT.
let pendingChange: Promise<unknown> = Promise.resolve();
let choiceVersion = 0;

function inOrder<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingChange.then(operation);
  pendingChange = result.catch(() => undefined);
  return result;
}

/**
 * The Parta opt-out keeps the device registered for other pushes (beer watch);
 * the PUT tells the server to skip Parta. Without a token or permission there
 * is nothing to update.
 */
async function keepDeviceWithoutParta(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!token || !Notifications) return true;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return true;
    return (await ensurePushTokenRegistered('granted')) !== null;
  } catch {
    return false;
  }
}

export type PushRegistration = 'registered' | 'denied' | 'unavailable' | 'cancelled';

/** Ask for notifications when undetermined, then register this device's token. */
async function requestAndRegister(
  isCurrent: () => boolean,
  friendPush?: boolean,
): Promise<PushRegistration> {
  if (!Notifications) return 'unavailable';
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (!isCurrent()) return 'cancelled';
    let status = existing.status;
    if (status === 'undetermined') {
      const requested = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: false, allowSound: false },
      });
      status = requested.status;
    }
    if (!isCurrent()) return 'cancelled';
    if (status !== 'granted') return 'denied';
    const token = await ensurePushTokenRegistered('granted', friendPush);
    if (!isCurrent()) return 'cancelled';
    return token ? 'registered' : 'unavailable';
  } catch {
    // Native permission APIs can be unavailable in an incompatible client.
    return 'unavailable';
  }
}

/**
 * Notification permission for a non-Parta feature (beer watch): prompts only
 * when undetermined and keeps the Parta choice as it is.
 */
export function requestPushRegistration(): Promise<Exclude<PushRegistration, 'cancelled'>> {
  return inOrder(async () => {
    await waitForSettingsHydration();
    const outcome = await requestAndRegister(() => true);
    return outcome === 'cancelled' ? 'unavailable' : outcome;
  });
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

    const outcome = await requestAndRegister(isCurrent, true);
    if (outcome === 'cancelled' || !isCurrent()) return { ok: false, reason: 'cancelled' };
    if (outcome === 'registered') {
      setFriendPushOptedOut(false);
      setFriendPushEnabled(true);
      return { ok: true };
    }
    setFriendPushEnabled(false);
    return { ok: false, reason: outcome };
  });
}

/**
 * Persist the opt-out and tell the server after earlier registrations finish.
 * Keep the choice on failure so launch/focus/foreground can retry it. Local pub
 * reminders have their own permission gate and do not change this device token.
 */
export function disableFriendPush(): Promise<boolean> {
  ++choiceVersion;
  // The settings UI is already hydrated. Persist immediately, before a possible
  // background/termination while waiting for an older network request.
  useSettingsStore.getState().setFriendPushEnabled(false);
  useSettingsStore.getState().setFriendPushOptedOut(true);
  return inOrder(keepDeviceWithoutParta);
}

/** Reconcile the persisted choice on launch, Parta focus and app foreground. */
export function ensureFriendPushRegisteredIfGranted(): Promise<void> {
  const version = choiceVersion;
  return inOrder(async () => {
    await waitForSettingsHydration();
    if (version !== choiceVersion) return;
    if (useSettingsStore.getState().friendPushOptedOut) {
      await keepDeviceWithoutParta();
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

type NotificationResponse = ExpoNotifications.NotificationResponse;
type Subscription = ExpoNotifications.Subscription;

/** The share token a tour invite push carries; anything else (or a malformed token) is not ours. */
export function tourInviteToken(response: NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data;
  const token = data?.kind === 'friend_tour_invite' ? data.tour_token : null;
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null;
}

// A launch tap can surface through both the cold-start read and the live event; it opens the tour once.
const handledInviteTaps = new Set<string>();
function claimInviteTap(response: NotificationResponse): boolean {
  const id = response.notification.request.identifier;
  if (handledInviteTaps.has(id)) return false;
  if (handledInviteTaps.size >= 32) handledInviteTaps.clear();
  handledInviteTaps.add(id);
  return true;
}

/** A tap on a tour invite while the app runs opens the tour, where the friend answers. */
export function subscribeTourInviteTap(onTap: (token: string) => void): Subscription {
  if (!Notifications) return { remove: () => undefined };
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const token = tourInviteToken(response);
    if (token && claimInviteTap(response)) onTap(token);
  });
}

/** A cold start from a tour invite tap opens the tour once. */
export async function consumeInitialTourInviteTap(onTap: (token: string) => void): Promise<void> {
  if (!Notifications) return;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    const token = tourInviteToken(response);
    if (!token || !response) return;
    await Notifications.clearLastNotificationResponseAsync();
    if (claimInviteTap(response)) onTap(token);
  } catch {
    // No launch notification, or the API is unavailable.
  }
}
