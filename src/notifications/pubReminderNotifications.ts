import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';
import type * as ExpoTaskManager from 'expo-task-manager';

import { fetchPubsNear, findNearbyPubs, type Pub } from '@/data/pubs';
import { trackApiFailure, type NativeErrorCategory } from '@/data/telemetryClient';
import { t } from '@/i18n';
import {
  clearPendingPubReminder,
  decidePubReminderOnEnter,
  isPubReminderEveningWindow,
  normalizePubReminderState,
  PUB_REMINDER_DWELL_MS,
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
/**
 * Ask the spatial index for extra candidates before applying the stricter
 * reminder policy. Otherwise one ambiguous restaurant among the nearest 20
 * could unnecessarily crowd out a confirmed pub just behind it.
 */
const MAX_GEOFENCE_CANDIDATES = 50;
/** Radius of each pub geofence (m). Tight enough that you're at the bar, not the street. */
const GEOFENCE_RADIUS_M = 75;
/** How far around the user we look for pubs to geofence (km). */
const GEOFENCE_FETCH_RADIUS_KM = 5;
/** Cached fixes older than this can point to a previous city after travel. */
const LAST_KNOWN_POSITION_MAX_AGE_MS = 15 * 60 * 1000;
/** Geofences only need city-block accuracy; worse cached fixes are ignored. */
const LAST_KNOWN_POSITION_REQUIRED_ACCURACY_M = 500;
/** Existing OS geofences survive app restarts. Give the foreground compass the
 * first nearby-catalogue slot instead of racing it during the critical launch. */
const STARTUP_GEOFENCE_REFRESH_DELAY_MS = 8_000;
const PUB_REMINDER_DWELL_SECONDS = PUB_REMINDER_DWELL_MS / 1000;

let startupGeofenceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const NATIVE_FAILURE_RETRY_MS = 60_000;
const NATIVE_FAILURE_REPORT_MS = 15 * 60_000;
let notificationRetryAfter = 0;
const nativeFailureReports = new Map<string, number>();

function reportReminderFailure(category: NativeErrorCategory): void {
  const state = AppState.currentState;
  const appState = state === 'active' || state === 'background' || state === 'inactive' ? state : 'unknown';
  const key = `${appState}:${category}`;
  const lastReport = nativeFailureReports.get(key);
  if (lastReport !== undefined && Date.now() - lastReport < NATIVE_FAILURE_REPORT_MS) return;
  nativeFailureReports.set(key, Date.now());
  trackApiFailure('pub_reminder_task', {
    reason: 'native_operation_failed', app_state: appState, error_category: category, retryable: true,
  });
}

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
    name: t.notifications.pubReminderChannel,
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180, 120, 180],
    lightColor: '#f6c45c',
  });
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

async function schedulePubReminder(pubName: string, pubId: string, fireAtMs: number): Promise<string | null> {
  if (!Notifications) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: t.notifications.pubReminderTitle(pubName),
      body: t.notifications.pubReminderBody,
      data: { kind: PUB_REMINDER_NOTIFICATION_KIND, pubId, fireAtMs },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: PUB_REMINDER_DWELL_SECONDS,
      repeats: false,
    },
  });
}

async function cancelScheduledPubReminder(notificationId: string | undefined): Promise<boolean> {
  if (!notificationId) return true;
  if (!Notifications) return false;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
    return true;
  } catch {
    // Keep the id in durable state until a later exit/disable can retry.
    reportReminderFailure('notification_cancel');
    return false;
  }
}

async function readPubReminderState(nowMs: number): Promise<PubReminderState> {
  const state = await readJson<PubReminderState>(PUB_REMINDER_STATE_KEY, {});
  return normalizePubReminderState(state, nowMs);
}

async function writePubReminderState(state: PubReminderState): Promise<void> {
  await writeJson(PUB_REMINDER_STATE_KEY, state);
}

export async function cancelPendingPubReminder(): Promise<void> {
  const nowMs = Date.now();
  const state = await readPubReminderState(nowMs);
  const pending = state.pendingReminder;
  if (!pending) {
    await writePubReminderState(state);
    return;
  }
  if (!(await cancelScheduledPubReminder(pending.notificationId))) return;
  await writePubReminderState(clearPendingPubReminder(state, nowMs));
}

async function cancelPendingPubReminderForPub(pubId: string): Promise<void> {
  const nowMs = Date.now();
  const state = await readPubReminderState(nowMs);
  const pending = state.pendingReminder;
  if (!pending || pending.pubId !== pubId) {
    await writePubReminderState(state);
    return;
  }
  if (!(await cancelScheduledPubReminder(pending.notificationId))) return;
  await writePubReminderState(clearPendingPubReminder(state, nowMs));
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
 * Background reminders require stronger evidence than the foreground compass.
 * A confirmed pub is eligible outright. Ambiguous/legacy places need a real
 * community beer signal; explicit non-pubs are always rejected.
 *
 * Kept pure and exported so changes to this privacy-sensitive gate stay easy to
 * review and test. Missing fields from older cached snapshots fail closed.
 */
export function isPubReminderEligible(
  pub: Pick<Pub, 'venueKind' | 'beers'>,
): boolean {
  if (pub.venueKind === 'not_pub') return false;
  if (pub.venueKind === 'pub') return true;
  return Boolean(
    pub.beers?.some((beer) => typeof beer?.name === 'string' && beer.name.trim().length > 0),
  );
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
    limit: MAX_GEOFENCE_CANDIDATES,
    maxKm: GEOFENCE_FETCH_RADIUS_KM,
  })
    .filter(({ pub }) => isPubReminderEligible(pub))
    .slice(0, MAX_GEOFENCES);

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
      notifyOnExit: true,
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
  if (Date.now() < notificationRetryAfter || !Notifications) return;
  if ((await Notifications.getPermissionsAsync()).status !== 'granted') {
    await cancelPendingPubReminder();
    return;
  }

  const now = new Date();
  if (!isPubReminderEveningWindow(now)) return;

  const nameById = await readJson<Record<string, string>>(PUB_REMINDER_GEOFENCES_KEY, {});
  const pubName = nameById[pubId];
  if (!pubName) return;

  const state = await readPubReminderState(now.getTime());
  const hasCounterSession = await hasActiveCounterSession();
  if (hasCounterSession) {
    if (state.pendingReminder) await cancelPendingPubReminder();
    else await writePubReminderState(state);
    return;
  }

  const decision = decidePubReminderOnEnter({
    nowMs: now.getTime(),
    isEveningWindow: true,
    hasActiveCounterSession: false,
    pub: { id: pubId, name: pubName },
    previousState: state,
  });

  if (decision.shouldNotify && decision.notificationPub) {
    if (!(await cancelScheduledPubReminder(decision.cancelPendingNotificationId))) return;
    const pending = decision.nextState.pendingReminder;
    if (!pending) {
      await writePubReminderState(decision.nextState);
      return;
    }
    let notificationId: string | null;
    try {
      notificationId = await schedulePubReminder(
        decision.notificationPub.name,
        decision.notificationPub.id,
        pending.fireAtMs,
      );
    } catch {
      // The previous notification was already cancelled. Do not leave it in
      // storage as if it will fire, or commit the new one that failed to schedule.
      await writePubReminderState(clearPendingPubReminder(state, now.getTime()));
      notificationRetryAfter = Date.now() + NATIVE_FAILURE_RETRY_MS;
      reportReminderFailure('notification_schedule');
      return;
    }
    notificationRetryAfter = 0;
    await writePubReminderState({
      ...decision.nextState,
      pendingReminder: notificationId ? { ...pending, notificationId } : undefined,
    });
    return;
  }

  await writePubReminderState(decision.nextState);
}

async function handleGeofenceExit(pubId: string): Promise<void> {
  // A previous disable may have failed to cancel in the OS. An exit can still
  // finish that cleanup even when new reminders are no longer enabled.
  await cancelPendingPubReminderForPub(pubId);
}

TaskManager?.defineTask(PUB_REMINDER_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    reportReminderFailure('geofence_task');
    return;
  }
  try {
    const { eventType, region } = (data as GeofenceTaskData | undefined) ?? {};
    const pubId = region?.identifier;
    if (typeof pubId !== 'string' || !pubId) return;
    if (eventType === Location.GeofencingEventType.Enter) {
      await handleGeofenceEnter(pubId);
    } else if (eventType === Location.GeofencingEventType.Exit) {
      await handleGeofenceExit(pubId);
    }
  } catch {
    // Expo otherwise logs the raw native exception from a rejected task. Keep
    // the failure visible without forwarding location or notification contents.
    reportReminderFailure('unknown');
  }
});

export async function initializePubReminderNotifications(): Promise<void> {
  await setAndroidChannel();
  if (!Notifications || !TaskManager) return;
  await waitForSettingsHydration();
  const enabled = useSettingsStore.getState().pubReminderEnabled;
  await setReminderEnabled(enabled);
  if (!enabled) {
    await cancelPendingPubReminder();
    await stopGeofencing();
    return;
  }

  const [notificationPermission, backgroundPermission] = await Promise.all([
    Notifications?.getPermissionsAsync() ?? Promise.resolve({ status: 'denied' }),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (notificationPermission.status !== 'granted' || backgroundPermission.status !== 'granted') {
    await cancelPendingPubReminder();
    await stopGeofencing();
    return;
  }

  if (!startupGeofenceRefreshTimer) {
    startupGeofenceRefreshTimer = setTimeout(() => {
      startupGeofenceRefreshTimer = null;
      if (AppState.currentState !== 'active') return;
      void refreshPubReminderGeofences();
    }, STARTUP_GEOFENCE_REFRESH_DELAY_MS);
  }
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
  if (await hasActiveCounterSession()) {
    await cancelPendingPubReminder();
  }
  try {
    const [background, notification] = await Promise.all([
      Location.getBackgroundPermissionsAsync(),
      Notifications?.getPermissionsAsync(),
    ]);
    if (background.status !== 'granted' || notification?.status !== 'granted') {
      await cancelPendingPubReminder();
      await stopGeofencing();
      return;
    }
  } catch {
    reportReminderFailure('permission');
    return;
  }
  await refreshGeofences();
}

export async function disablePubReminderNotifications(): Promise<void> {
  await setReminderEnabled(false);
  await cancelPendingPubReminder();
  await stopGeofencing();
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
