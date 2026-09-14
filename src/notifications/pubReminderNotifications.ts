import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppState, Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';
import type * as ExpoTaskManager from 'expo-task-manager';

import { disablePushDevice, PUSH_TOKEN_KEY } from '@/data/pushDeviceClient';
import {
  capturePrivateAccountMutationScope,
  isPrivateAccountMutationFrozen,
  isPrivateAccountMutationScopeCurrent,
  runPrivateAccountMutation,
} from '@/data/privateAccountBoundary';
import type { ExplicitEntryReservation } from '@/data/inviteNavigation';
import {
  beginNotificationResponseEvent,
  claimHandledNotificationResponse,
  clearNotificationResponseIfStillLast,
  resetNotificationResponseRuntimeForTests,
  type NotificationResponseClaim,
} from './notificationResponseLedger';
import { fetchPubsNear, findNearbyPubs, type Pub } from '@/data/pubs';
import { t } from '@/i18n';
import { ensurePushTokenRegistered } from '@/notifications/pushToken';
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
const PUB_REMINDER_BOUNDARY_KEY = 'na-pivo-pub-reminder-boundary';
const PUB_REMINDER_BOUNDARY_FIELD = '__account_boundary_token';
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

async function readPubReminderBoundaryToken(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(PUB_REMINDER_BOUNDARY_KEY)) ?? '0';
  } catch {
    return null;
  }
}

async function pubReminderBoundaryIsCurrent(token: string): Promise<boolean> {
  return (await readPubReminderBoundaryToken()) === token;
}

async function advancePubReminderBoundary(): Promise<string | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await AsyncStorage.setItem(PUB_REMINDER_BOUNDARY_KEY, token);
    return (await AsyncStorage.getItem(PUB_REMINDER_BOUNDARY_KEY)) === token
      ? token
      : null;
  } catch {
    return null;
  }
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

async function cancelScheduledPubReminder(notificationId: string | undefined): Promise<void> {
  if (!Notifications || !notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Best effort: state cleanup still prevents us from chaining new spam.
  }
}

async function readPubReminderState(nowMs: number): Promise<PubReminderState> {
  const raw = await readJson<unknown>(PUB_REMINDER_STATE_KEY, {});
  const state = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as PubReminderState
    : {};
  return normalizePubReminderState(state, nowMs);
}

async function writePubReminderStateForBoundary(
  state: PubReminderState,
  token: string,
): Promise<boolean> {
  const serialized = JSON.stringify({
    ...state,
    [PUB_REMINDER_BOUNDARY_FIELD]: token,
  });
  try {
    await AsyncStorage.setItem(PUB_REMINDER_STATE_KEY, serialized);
    if (await pubReminderBoundaryIsCurrent(token)) return true;
    // Remove only our stale write; never delete a newer account's state.
    if ((await AsyncStorage.getItem(PUB_REMINDER_STATE_KEY)) === serialized) {
      await AsyncStorage.removeItem(PUB_REMINDER_STATE_KEY);
    }
  } catch {
    return false;
  }
  return false;
}

export async function cancelPendingPubReminder(): Promise<void> {
  const boundaryToken = await readPubReminderBoundaryToken();
  if (!boundaryToken) return;
  const nowMs = Date.now();
  const state = await readPubReminderState(nowMs);
  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) return;
  const pending = state.pendingReminder;
  if (!pending) {
    await writePubReminderStateForBoundary(state, boundaryToken);
    return;
  }
  await cancelScheduledPubReminder(pending.notificationId);
  await writePubReminderStateForBoundary(clearPendingPubReminder(state, nowMs), boundaryToken);
}

async function cancelPendingPubReminderForPub(
  pubId: string,
  capturedBoundaryToken?: string,
): Promise<void> {
  const boundaryToken = capturedBoundaryToken ?? await readPubReminderBoundaryToken();
  if (!boundaryToken) return;
  const nowMs = Date.now();
  const state = await readPubReminderState(nowMs);
  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) return;
  const pending = state.pendingReminder;
  if (!pending || pending.pubId !== pubId) {
    await writePubReminderStateForBoundary(state, boundaryToken);
    return;
  }
  await cancelScheduledPubReminder(pending.notificationId);
  await writePubReminderStateForBoundary(clearPendingPubReminder(state, nowMs), boundaryToken);
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
async function refreshGeofences(
  coords?: { lat: number; lng: number },
  capturedBoundaryToken?: string,
): Promise<void> {
  const boundaryToken = capturedBoundaryToken ?? await readPubReminderBoundaryToken();
  if (!boundaryToken) return;
  const center = coords ?? (await resolveCoords());
  if (!center || !(await pubReminderBoundaryIsCurrent(boundaryToken))) return;

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
    if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) return;
    await stopGeofencing();
    if (await pubReminderBoundaryIsCurrent(boundaryToken)) {
      await writeJson(PUB_REMINDER_GEOFENCES_KEY, {
        [PUB_REMINDER_BOUNDARY_FIELD]: boundaryToken,
      });
    }
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

  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) return;
  const taggedNames = {
    ...nameById,
    [PUB_REMINDER_BOUNDARY_FIELD]: boundaryToken,
  };
  await writeJson(PUB_REMINDER_GEOFENCES_KEY, taggedNames);
  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) {
    const current = await readJson<Record<string, string>>(PUB_REMINDER_GEOFENCES_KEY, {});
    if (current[PUB_REMINDER_BOUNDARY_FIELD] === boundaryToken) {
      await AsyncStorage.removeItem(PUB_REMINDER_GEOFENCES_KEY).catch(() => undefined);
    }
    return;
  }
  try {
    await Location.startGeofencingAsync(PUB_REMINDER_GEOFENCE_TASK, regions);
  } catch {
    // Permissions revoked between the gate and here — leave geofencing stopped.
    return;
  }
  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) {
    const current = await readJson<Record<string, string>>(PUB_REMINDER_GEOFENCES_KEY, {});
    // This callback just completed a stale native start. Stop it regardless of
    // whether strict clear already removed its tagged map.
    await stopGeofencing();
    if (current[PUB_REMINDER_BOUNDARY_FIELD] === boundaryToken) {
      await AsyncStorage.removeItem(PUB_REMINDER_GEOFENCES_KEY).catch(() => undefined);
    }
  }
}

async function handleGeofenceEnter(pubId: string, boundaryToken: string): Promise<void> {
  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) return;
  if (!(await isReminderEnabled())) return;

  const now = new Date();
  if (!isPubReminderEveningWindow(now)) return;

  const nameById = await readJson<Record<string, string>>(PUB_REMINDER_GEOFENCES_KEY, {});
  const pubName = nameById[pubId];
  if (!pubName) return;

  const state = await readPubReminderState(now.getTime());
  const hasCounterSession = await hasActiveCounterSession();
  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) return;
  if (hasCounterSession) {
    if (state.pendingReminder) {
      await cancelScheduledPubReminder(state.pendingReminder.notificationId);
      await writePubReminderStateForBoundary(
        clearPendingPubReminder(state, now.getTime()),
        boundaryToken,
      );
    } else {
      await writePubReminderStateForBoundary(state, boundaryToken);
    }
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
    await cancelScheduledPubReminder(decision.cancelPendingNotificationId);
    const pending = decision.nextState.pendingReminder;
    if (!pending) {
      await writePubReminderStateForBoundary(decision.nextState, boundaryToken);
      return;
    }
    const notificationId = await schedulePubReminder(
      decision.notificationPub.name,
      decision.notificationPub.id,
      pending.fireAtMs,
    );
    if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) {
      await cancelScheduledPubReminder(notificationId ?? undefined);
      return;
    }
    await writePubReminderStateForBoundary({
      ...decision.nextState,
      pendingReminder: notificationId ? { ...pending, notificationId } : undefined,
    }, boundaryToken);
    return;
  }

  await writePubReminderStateForBoundary(decision.nextState, boundaryToken);
}

async function handleGeofenceExit(pubId: string, boundaryToken: string): Promise<void> {
  if (!(await pubReminderBoundaryIsCurrent(boundaryToken))) return;
  if (!(await isReminderEnabled())) return;
  await cancelPendingPubReminderForPub(pubId, boundaryToken);
}

TaskManager?.defineTask(PUB_REMINDER_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const boundaryToken = await readPubReminderBoundaryToken();
  if (!boundaryToken) return;
  const { eventType, region } = (data as GeofenceTaskData | undefined) ?? {};
  const pubId = region?.identifier;
  if (!pubId) return;
  if (eventType === Location.GeofencingEventType.Enter) {
    await handleGeofenceEnter(pubId, boundaryToken);
  } else if (eventType === Location.GeofencingEventType.Exit) {
    await handleGeofenceExit(pubId, boundaryToken);
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
    return;
  }

  void ensurePushTokenRegistered(permissionStatus(notificationPermission.status));
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
  if (await hasActiveCounterSession()) {
    await cancelPendingPubReminder();
  }
  try {
    const background = await Location.getBackgroundPermissionsAsync();
    if (background.status !== 'granted') return;
  } catch {
    return;
  }
  await refreshGeofences();
}

function isScheduledPubReminder(
  notification: ExpoNotifications.NotificationRequest,
): boolean {
  return notification.content.data?.kind === PUB_REMINDER_NOTIFICATION_KIND;
}

/** Strict account-boundary cleanup; the enabled device preference is preserved. */
export async function clearPubReminderAccountData(): Promise<boolean> {
  if (startupGeofenceRefreshTimer) {
    clearTimeout(startupGeofenceRefreshTimer);
    startupGeofenceRefreshTimer = null;
  }

  // Persisted first: a headless bridge that already captured the previous token
  // must cancel its late notification/geofence instead of recreating A state.
  const boundaryToken = await advancePubReminderBoundary();
  if (!boundaryToken) return false;

  let notificationsClear = false;
  if (Notifications) {
    try {
      // Capture A before any cleanup await. Expo clears the last response
      // without an identifier, so the shared identity guard must re-read it
      // immediately before clearing and leave a newer B untouched.
      const outgoingLastResponse = await Notifications.getLastNotificationResponseAsync();
      // The persisted blob is background-written and can be truncated by an OS
      // kill. Treat malformed JSON as empty instead of letting it prevent the
      // rest of strict account cleanup.
      const state = await readPubReminderState(Date.now());
      await cancelScheduledPubReminder(state.pendingReminder?.notificationId);

      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      await Promise.all(
        scheduled
          .filter(isScheduledPubReminder)
          .map((request) =>
            Notifications.cancelScheduledNotificationAsync(request.identifier)
              .catch(() => undefined),
          ),
      );
      // Already-delivered A content (including friend pushes) is private too.
      await Notifications.dismissAllNotificationsAsync();
      if (outgoingLastResponse) {
        await clearNotificationResponseIfStillLast(Notifications, outgoingLastResponse);
      }
      const remainingLastResponse = await Notifications.getLastNotificationResponseAsync();
      const lastResponseClear =
        !outgoingLastResponse ||
        remainingLastResponse?.notification.request.identifier !==
          outgoingLastResponse.notification.request.identifier;
      const [remainingScheduled, remainingPresented] = await Promise.all([
        Notifications.getAllScheduledNotificationsAsync(),
        Notifications.getPresentedNotificationsAsync(),
      ]);
      notificationsClear =
        !remainingScheduled.some(isScheduledPubReminder) &&
        remainingPresented.length === 0 &&
        lastResponseClear;
    } catch {
      notificationsClear = false;
    }
  }

  let geofencesClear = false;
  try {
    if (Platform.OS === 'android') {
      // Expo Location gates even its stop/read methods on background permission.
      // TaskManager invokes the same native consumer cleanup after revocation.
      if (TaskManager && await TaskManager.isTaskRegisteredAsync(PUB_REMINDER_GEOFENCE_TASK)) {
        await TaskManager.unregisterTaskAsync(PUB_REMINDER_GEOFENCE_TASK);
      }
      geofencesClear = TaskManager !== null &&
        (await TaskManager.isTaskRegisteredAsync(PUB_REMINDER_GEOFENCE_TASK)) === false;
    } else {
      if (await Location.hasStartedGeofencingAsync(PUB_REMINDER_GEOFENCE_TASK)) {
        await Location.stopGeofencingAsync(PUB_REMINDER_GEOFENCE_TASK);
      }
      geofencesClear = !(await Location.hasStartedGeofencingAsync(
        PUB_REMINDER_GEOFENCE_TASK,
      ));
    }
  } catch {
    geofencesClear = false;
  }

  let storageClear = true;
  for (const key of [PUB_REMINDER_STATE_KEY, PUB_REMINDER_GEOFENCES_KEY]) {
    try {
      await AsyncStorage.removeItem(key);
      if ((await AsyncStorage.getItem(key)) !== null) storageClear = false;
    } catch {
      storageClear = false;
    }
  }

  return notificationsClear && geofencesClear && storageClear;
}

export async function disablePubReminderNotifications(): Promise<void> {
  await setReminderEnabled(false);
  await cancelPendingPubReminder();
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
  kind: string | null;
  activityId: string | null;
  friendshipId: string | null;
  notificationId?: string | null;
}

export interface InitialPubReminderNavigationLease {
  claimPubReminder(notificationId: string | null): ExplicitEntryReservation | null;
  claimFriend(payload: FriendTapPayload): ExplicitEntryReservation | null;
}

export function resetNotificationResponseDeduperForTests(): void {
  resetNotificationResponseRuntimeForTests();
}

async function claimInitialNotificationResponse(
  response: ExpoNotifications.NotificationResponse,
  reservation: ExplicitEntryReservation | null,
  isCurrent: () => boolean,
): Promise<NotificationResponseClaim | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!isCurrent() || (reservation && !reservation.isCurrent())) {
      reservation?.release();
      return null;
    }
    const claim = await claimHandledNotificationResponse(response);
    if (claim === 'unavailable') continue;
    if (!isCurrent() || (reservation && !reservation.commit())) {
      reservation?.release();
      return null;
    }
    return claim;
  }
  reservation?.release();
  return null;
}

function isFriendResponse(response: ExpoNotifications.NotificationResponse | null): boolean {
  const kind = response?.notification.request.content.data?.kind;
  return typeof kind === 'string' && kind.startsWith('friend_');
}

/** Extract the activity/friendship ids a friend push carries, when present. */
function friendTapPayload(response: ExpoNotifications.NotificationResponse | null): FriendTapPayload {
  const data = response?.notification.request.content.data;
  return {
    kind: typeof data?.kind === 'string' ? data.kind : null,
    activityId: typeof data?.activity_id === 'string' ? data.activity_id : null,
    friendshipId: typeof data?.friendship_id === 'string' ? data.friendship_id : null,
    notificationId: response?.notification.request.identifier ?? null,
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
    if (isPrivateAccountMutationFrozen()) return;
    const kind = notification.request.content.data?.kind;
    if (typeof kind === 'string' && kind.startsWith('friend_')) onReceived(kind);
  });
}

/** Subscribe to taps on a pub-reminder / friend notification while the app runs. */
export function subscribePubReminderTap(
  onTap: () => void,
  onFriendTap?: (payload: FriendTapPayload) => void,
  navigationLease?: InitialPubReminderNavigationLease,
): ExpoNotifications.Subscription {
  if (!Notifications) {
    return { remove: () => undefined };
  }
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const scope = capturePrivateAccountMutationScope();
    if (!isPrivateAccountMutationScopeCurrent(scope)) return;
    if (isPubReminderResponse(response)) {
      const responseEvent = beginNotificationResponseEvent(response);
      if (!responseEvent) return;
      const notificationId = response.notification.request.identifier;
      const reservation = navigationLease?.claimPubReminder(notificationId) ?? null;
      if (navigationLease && !reservation) {
        responseEvent.release();
        return;
      }
      void (async () => {
        try {
          const claim = await claimHandledNotificationResponse(response);
          if (
            claim === 'unavailable' ||
            !responseEvent.isCurrent() ||
            !isPrivateAccountMutationScopeCurrent(scope) ||
            (reservation && !reservation.commit())
          ) return;
          if (claim === 'claimed') onTap();
          await clearNotificationResponseIfStillLast(
            Notifications,
            response,
            () =>
              responseEvent.isCurrent() &&
              isPrivateAccountMutationScopeCurrent(scope),
          );
        } finally {
          reservation?.release();
          responseEvent.release();
        }
      })().catch(() => undefined);
    } else if (onFriendTap && isFriendResponse(response)) {
      const responseEvent = beginNotificationResponseEvent(response);
      if (!responseEvent) return;
      const payload = friendTapPayload(response);
      const reservation = navigationLease?.claimFriend(payload) ?? null;
      if (navigationLease && !reservation) {
        responseEvent.release();
        return;
      }
      void (async () => {
        try {
          const claim = await claimHandledNotificationResponse(response);
          if (
            claim === 'unavailable' ||
            !responseEvent.isCurrent() ||
            !isPrivateAccountMutationScopeCurrent(scope) ||
            (reservation && !reservation.commit())
          ) return;
          if (claim === 'claimed') onFriendTap(payload);
          await clearNotificationResponseIfStillLast(
            Notifications,
            response,
            () =>
              responseEvent.isCurrent() &&
              isPrivateAccountMutationScopeCurrent(scope),
          );
        } finally {
          reservation?.release();
          responseEvent.release();
        }
      })().catch(() => undefined);
    }
  });
}

/** Handle a cold-start launch triggered by tapping a pub-reminder / friend notification. */
export async function consumeInitialPubReminderTap(
  onTap: () => void,
  onFriendTap?: (payload: FriendTapPayload) => void,
  navigationLease?: InitialPubReminderNavigationLease,
): Promise<void> {
  if (!Notifications) return;
  try {
    await runPrivateAccountMutation(async (scope) => {
      const response = await Notifications.getLastNotificationResponseAsync();
      // The native read can outlive account A. Validate its captured lease
      // before touching the process deduper, routing, or native response state.
      if (!isPrivateAccountMutationScopeCurrent(scope)) return;
      if (isPubReminderResponse(response)) {
        if (!response) return;
        const responseEvent = beginNotificationResponseEvent(response);
        if (!responseEvent) return;
        const notificationId = response?.notification.request.identifier ?? null;
        const reservation = navigationLease?.claimPubReminder(notificationId) ?? null;
        if (navigationLease && !reservation) {
          responseEvent.release();
          return;
        }
        try {
          const claim = await claimInitialNotificationResponse(
            response,
            reservation,
            () =>
              responseEvent.isCurrent() &&
              isPrivateAccountMutationScopeCurrent(scope),
          );
          if (!claim) return;
          if (claim === 'claimed') onTap();
          await clearNotificationResponseIfStillLast(
            Notifications,
            response,
            () =>
              responseEvent.isCurrent() &&
              isPrivateAccountMutationScopeCurrent(scope),
          );
        } finally {
          responseEvent.release();
        }
      } else if (onFriendTap && isFriendResponse(response)) {
        if (!response) return;
        const responseEvent = beginNotificationResponseEvent(response);
        if (!responseEvent) return;
        const payload = friendTapPayload(response);
        const reservation = navigationLease?.claimFriend(payload) ?? null;
        if (navigationLease && !reservation) {
          responseEvent.release();
          return;
        }
        try {
          const claim = await claimInitialNotificationResponse(
            response,
            reservation,
            () =>
              responseEvent.isCurrent() &&
              isPrivateAccountMutationScopeCurrent(scope),
          );
          if (!claim) return;
          if (claim === 'claimed') onFriendTap(payload);
          await clearNotificationResponseIfStillLast(
            Notifications,
            response,
            () =>
              responseEvent.isCurrent() &&
              isPrivateAccountMutationScopeCurrent(scope),
          );
        } finally {
          responseEvent.release();
        }
      }
    });
  } catch {
    // No launch notification, or the API is unavailable — nothing to route to.
  }
}
