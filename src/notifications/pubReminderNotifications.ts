import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';
import type * as ExpoTaskManager from 'expo-task-manager';

import { disablePushDevice, PUSH_TOKEN_KEY } from '@/data/pushDeviceClient';
import { fetchPubsNear, findNearbyPubs } from '@/data/pubs';
import { ensurePushTokenRegistered } from '@/notifications/pushToken';
import {
  decidePubReminderOnEnter,
  isPubReminderEveningWindow,
  type PubReminderState,
} from '@/notifications/pubReminderDecision';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';

const PUB_REMINDER_GEOFENCE_TASK = 'na-pivo-pub-reminder-geofence';
const PUB_REMINDER_CHANNEL_ID = 'pub-reminders';
const PUB_REMINDER_ENABLED_KEY = 'na-pivo-pub-reminders-enabled';
const PUB_REMINDER_STATE_KEY = 'na-pivo-pub-reminder-state';
const PUB_REMINDER_GEOFENCES_KEY = 'na-pivo-pub-reminder-geofences';
const TALLY_STORE_KEY = 'na-pivo-tally';

const PUB_REMINDER_NOTIFICATION_KIND = 'pub_reminder';

/** iOS monitors at most 20 regions per app — cap the fleet to the nearest pubs. */
const MAX_GEOFENCES = 20;
/** Radius of each pub geofence (m). Tight enough that you're at the bar, not the street. */
const GEOFENCE_RADIUS_M = 75;
/** How far around the user we look for pubs to geofence (km). */
const GEOFENCE_FETCH_RADIUS_KM = 5;
/** Cached fixes older than this can point to a previous city after travel. */
const LAST_KNOWN_POSITION_MAX_AGE_MS = 15 * 60 * 1000;
/** Geofences only need city-block accuracy; worse cached fixes are ignored. */
const LAST_KNOWN_POSITION_REQUIRED_ACCURACY_M = 500;

export type PubReminderEnableResult =
  | { ok: true }
  | { ok: false; reason: 'notifications-denied' | 'foreground-location-denied' | 'background-location-denied' };

type GeofenceTaskData = {
  eventType?: Location.GeofencingEventType;
  region?: Location.LocationRegion;
};

type NotificationsModule = typeof ExpoNotifications;
type TaskManagerModule = typeof ExpoTaskManager;

function loadNotifications(): NotificationsModule | null {
  try {
    // Some local dev builds can miss ExpoPushTokenManager even when the JS
    // package is present. Keep the app usable; push features no-op until the
    // native module is available in the installed build.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();

function loadTaskManager(): TaskManagerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-task-manager') as TaskManagerModule;
  } catch {
    return null;
  }
}

const TaskManager = loadTaskManager();

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function setAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications) return;
  await Notifications.setNotificationChannelAsync(PUB_REMINDER_CHANNEL_ID, {
    name: 'Připomínky v hospodě',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#f6c45c',
  });
}

function permissionStatus(status: string | null | undefined): 'granted' | 'denied' | 'undetermined' {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best effort only; reminder state can reset safely.
  }
}

async function isReminderEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PUB_REMINDER_ENABLED_KEY)) === 'true';
  } catch {
    return false;
  }
}

async function setReminderEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PUB_REMINDER_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // The visible settings store remains the source for the UI.
  }
}

async function hasActiveCounterSession(): Promise<boolean> {
  const persisted = await readJson<{ state?: { current?: { drinks?: unknown[] } | null } } | null>(
    TALLY_STORE_KEY,
    null,
  );
  const drinks = persisted?.state?.current?.drinks;
  return Array.isArray(drinks) && drinks.length > 0;
}

async function schedulePubReminder(pubName: string): Promise<void> {
  if (!Notifications) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Sedíš v ${pubName}?`,
      body: 'Naťukni počítadlo a sečti dnešní rundy.',
      data: { kind: PUB_REMINDER_NOTIFICATION_KIND },
    },
    trigger: null,
  });
}

function locationCoords(position: Location.LocationObject | null): { lat: number; lng: number } | null {
  const latitude = position?.coords.latitude;
  const longitude = position?.coords.longitude;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  return { lat: latitude, lng: longitude };
}

/** Best-effort current position: prefer a recent cached fix, fall back to a fresh one. */
async function resolveCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({
      maxAge: LAST_KNOWN_POSITION_MAX_AGE_MS,
      requiredAccuracy: LAST_KNOWN_POSITION_REQUIRED_ACCURACY_M,
    });
    const coords = locationCoords(last);
    if (coords) return coords;
  } catch {
    // ignore — try a fresh fix below
  }
  try {
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return locationCoords(current);
  } catch {
    return null;
  }
}

async function stopGeofencing(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(PUB_REMINDER_GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(PUB_REMINDER_GEOFENCE_TASK);
    }
  } catch {
    // Nothing registered, or the task is unknown — treat as already stopped.
  }
}

/**
 * (Re)register geofences around the user's current area. We fetch nearby pubs
 * (cheap: fetchPubsNear short-circuits within ~2 km and serves a 24h snapshot),
 * keep the nearest MAX_GEOFENCES, and hand them to the OS. The pubId→name map is
 * persisted so the background task can title the notification without any
 * in-memory pub index, which a cold background launch wouldn't have.
 *
 * Limitation: geofences track the area sampled here. If the user travels far
 * with the app closed they won't be re-seeded until the app next runs — by
 * design we never keep a live background location stream. Worst case is a missed
 * nudge, never a wrong one.
 */
async function refreshGeofences(coords?: { lat: number; lng: number }): Promise<void> {
  const center = coords ?? (await resolveCoords());
  if (!center) return;

  try {
    await fetchPubsNear(center.lat, center.lng, undefined, { radiusKm: GEOFENCE_FETCH_RADIUS_KM });
  } catch {
    // Offline / fetch failure: fall through to whatever the in-memory index holds.
  }

  const nearby = findNearbyPubs({
    lat: center.lat,
    lng: center.lng,
    limit: MAX_GEOFENCES,
    maxKm: GEOFENCE_FETCH_RADIUS_KM,
  });

  if (nearby.length === 0) {
    await stopGeofencing();
    await writeJson(PUB_REMINDER_GEOFENCES_KEY, {});
    return;
  }

  const nameById: Record<string, string> = {};
  const regions = nearby.map(({ pub }) => {
    nameById[pub.id] = pub.name;
    return {
      identifier: pub.id,
      latitude: pub.lat,
      longitude: pub.lng,
      radius: GEOFENCE_RADIUS_M,
      notifyOnEnter: true,
      notifyOnExit: false,
    };
  });

  await writeJson(PUB_REMINDER_GEOFENCES_KEY, nameById);
  try {
    await Location.startGeofencingAsync(PUB_REMINDER_GEOFENCE_TASK, regions);
  } catch {
    // Permissions revoked between the gate and here — leave geofencing stopped.
  }
}

async function handleGeofenceEnter(pubId: string): Promise<void> {
  if (!(await isReminderEnabled())) return;

  const now = new Date();
  if (!isPubReminderEveningWindow(now)) return;

  const nameById = await readJson<Record<string, string>>(PUB_REMINDER_GEOFENCES_KEY, {});
  const pubName = nameById[pubId];
  if (!pubName) return;

  const state = await readJson<PubReminderState>(PUB_REMINDER_STATE_KEY, {});
  const decision = decidePubReminderOnEnter({
    nowMs: now.getTime(),
    isEveningWindow: true,
    hasActiveCounterSession: await hasActiveCounterSession(),
    pub: { id: pubId, name: pubName },
    previousState: state,
  });

  await writeJson(PUB_REMINDER_STATE_KEY, decision.nextState);
  if (decision.shouldNotify && decision.notificationPub) {
    await schedulePubReminder(decision.notificationPub.name);
  }
}

TaskManager?.defineTask(PUB_REMINDER_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const { eventType, region } = (data as GeofenceTaskData | undefined) ?? {};
  if (eventType !== Location.GeofencingEventType.Enter) return;
  const pubId = region?.identifier;
  if (!pubId) return;
  await handleGeofenceEnter(pubId);
});

export async function initializePubReminderNotifications(): Promise<void> {
  await setAndroidChannel();
  if (!Notifications || !TaskManager) return;
  await waitForSettingsHydration();
  const enabled = useSettingsStore.getState().pubReminderEnabled;
  await setReminderEnabled(enabled);
  if (!enabled) {
    await stopGeofencing();
    return;
  }

  const [notificationPermission, backgroundPermission] = await Promise.all([
    Notifications?.getPermissionsAsync() ?? Promise.resolve({ status: 'denied' }),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (notificationPermission.status !== 'granted' || backgroundPermission.status !== 'granted') {
    return;
  }

  void ensurePushTokenRegistered(permissionStatus(notificationPermission.status));
  await refreshGeofences();
}

export async function enablePubReminderNotifications(): Promise<PubReminderEnableResult> {
  await setAndroidChannel();
  if (!Notifications || !TaskManager) {
    await setReminderEnabled(false);
    return { ok: false, reason: 'notifications-denied' };
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    await setReminderEnabled(false);
    return { ok: false, reason: 'foreground-location-denied' };
  }

  const notificationPermission = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: false,
    },
  });
  if (notificationPermission.status !== 'granted') {
    await setReminderEnabled(false);
    return { ok: false, reason: 'notifications-denied' };
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    await setReminderEnabled(false);
    return { ok: false, reason: 'background-location-denied' };
  }

  await setReminderEnabled(true);
  void ensurePushTokenRegistered(permissionStatus(notificationPermission.status));
  await refreshGeofences();
  return { ok: true };
}

/**
 * Re-seed geofences for the user's current area. Safe and cheap to call on every
 * app foreground: it no-ops when the feature is off or background location isn't
 * granted, and fetchPubsNear short-circuits unless the user moved a few km.
 */
export async function refreshPubReminderGeofences(): Promise<void> {
  if (!TaskManager) return;
  if (!useSettingsStore.getState().pubReminderEnabled) return;
  try {
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.status !== 'granted') return;
  } catch {
    return;
  }
  await refreshGeofences();
}

export async function disablePubReminderNotifications(): Promise<void> {
  await setReminderEnabled(false);
  await stopGeofencing();
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) void disablePushDevice(token);
  } catch {
    // Without the local token, avoid disabling every device on the account.
  }
}

function isPubReminderResponse(response: ExpoNotifications.NotificationResponse | null): boolean {
  const kind = response?.notification.request.content.data?.kind;
  return kind === PUB_REMINDER_NOTIFICATION_KIND;
}

/** Deep-link payload a friend push carries so Parta can scroll to the row (§F3). */
export interface FriendTapPayload {
  activityId: string | null;
  friendshipId: string | null;
}

function isFriendResponse(response: ExpoNotifications.NotificationResponse | null): boolean {
  const kind = response?.notification.request.content.data?.kind;
  return (
    kind === 'friend_request' ||
    kind === 'friend_accepted' ||
    kind === 'friend_at_pub' ||
    kind === 'friend_rsvp' ||
    kind === 'friend_cheers' ||
    kind === 'friend_plan'
  );
}

/** Extract the activity/friendship ids a friend push carries, when present. */
function friendTapPayload(response: ExpoNotifications.NotificationResponse | null): FriendTapPayload {
  const data = response?.notification.request.content.data;
  return {
    activityId: typeof data?.activity_id === 'string' ? data.activity_id : null,
    friendshipId: typeof data?.friendship_id === 'string' ? data.friendship_id : null,
  };
}

/**
 * Subscribe to friend pushes RECEIVED (not tapped) while the app is foregrounded,
 * so the Parta tab badge lights up even on another tab that hasn't mounted
 * FriendsScreen yet (§D1). Fires the notification's `kind` back to the caller.
 */
export function subscribeFriendPushReceived(
  onReceived: (kind: string) => void,
): ExpoNotifications.Subscription {
  if (!Notifications) {
    return { remove: () => undefined };
  }
  return Notifications.addNotificationReceivedListener((notification) => {
    const kind = notification.request.content.data?.kind;
    if (typeof kind === 'string' && kind.startsWith('friend_')) onReceived(kind);
  });
}

/** Subscribe to taps on a pub-reminder / friend notification while the app runs. */
export function subscribePubReminderTap(
  onTap: () => void,
  onFriendTap?: (payload: FriendTapPayload) => void,
): ExpoNotifications.Subscription {
  if (!Notifications) {
    return { remove: () => undefined };
  }
  return Notifications.addNotificationResponseReceivedListener((response) => {
    if (isPubReminderResponse(response)) onTap();
    else if (onFriendTap && isFriendResponse(response)) onFriendTap(friendTapPayload(response));
  });
}

/** Handle a cold-start launch triggered by tapping a pub-reminder / friend notification. */
export async function consumeInitialPubReminderTap(
  onTap: () => void,
  onFriendTap?: (payload: FriendTapPayload) => void,
): Promise<void> {
  if (!Notifications) return;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (isPubReminderResponse(response)) {
      onTap();
      await Notifications.clearLastNotificationResponseAsync();
    } else if (onFriendTap && isFriendResponse(response)) {
      onFriendTap(friendTapPayload(response));
      await Notifications.clearLastNotificationResponseAsync();
    }
  } catch {
    // No launch notification, or the API is unavailable — nothing to route to.
  }
}
