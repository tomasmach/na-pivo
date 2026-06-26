import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { disablePushDevice, registerPushDevice } from '@/data/pushDeviceClient';
import { fetchPubsNear, findNearestPub } from '@/data/pubs';
import { haversineMeters } from '@/compass/distance';
import {
  decidePubReminder,
  isPubReminderEveningWindow,
  type PubReminderMode,
  type PubReminderState,
} from '@/notifications/pubReminderDecision';
import { useSettingsStore } from '@/stores/settingsStore';

const PUB_REMINDER_TASK_NAME = 'na-pivo-pub-reminder-location';
const PUB_REMINDER_CHANNEL_ID = 'pub-reminders';
const PUB_REMINDER_ENABLED_KEY = 'na-pivo-pub-reminders-enabled';
const PUB_REMINDER_STATE_KEY = 'na-pivo-pub-reminder-state';
const PUSH_TOKEN_KEY = 'na-pivo-expo-push-token';
const TALLY_STORE_KEY = 'na-pivo-tally';

const HOURLY_INTERVAL_MS = 60 * 60 * 1000;
const RECHECK_INTERVAL_MS = 15 * 60 * 1000;
const SEARCH_RADIUS_KM = 0.5;
const FIND_RADIUS_KM = 0.2;

export type PubReminderEnableResult =
  | { ok: true }
  | { ok: false; reason: 'notifications-denied' | 'foreground-location-denied' | 'background-location-denied' };

type LocationTaskData = {
  locations?: Location.LocationObject[];
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function setAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
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

function locationOptions(mode: PubReminderMode) {
  const recheck = mode === 'recheck';
  return {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: recheck ? RECHECK_INTERVAL_MS : HOURLY_INTERVAL_MS,
    distanceInterval: recheck ? 60 : 500,
    deferredUpdatesInterval: recheck ? RECHECK_INTERVAL_MS : HOURLY_INTERVAL_MS,
    deferredUpdatesDistance: recheck ? 60 : 500,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: false,
    foregroundService: {
      notificationTitle: 'Na pivo hlídá hospodu',
      notificationBody: 'Jen večer a úsporně. Ať víš, kdy počítat piva.',
      notificationColor: '#f6c45c',
    },
  };
}

async function configureLocationUpdates(mode: PubReminderMode): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(PUB_REMINDER_TASK_NAME);
  if (started) {
    await Location.stopLocationUpdatesAsync(PUB_REMINDER_TASK_NAME);
  }
  await Location.startLocationUpdatesAsync(PUB_REMINDER_TASK_NAME, locationOptions(mode));
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
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Hele, nejsi náhodou v hospodě?',
      body: `${pubName}: vyber hospodu a počítej piva, ať večer neutíká bokem.`,
      data: { kind: 'pub_reminder' },
    },
    trigger: null,
  });
}

async function getAndRegisterPushToken(status: 'granted' | 'denied' | 'undetermined'): Promise<string | null> {
  if (status !== 'granted') return null;
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

async function handleLocationSample(location: Location.LocationObject): Promise<void> {
  if (!(await isReminderEnabled())) return;

  const now = new Date();
  const nowMs = now.getTime();
  const isEveningWindow = isPubReminderEveningWindow(now);
  const state = await readJson<PubReminderState>(PUB_REMINDER_STATE_KEY, {});

  if (!isEveningWindow) {
    const decision = decidePubReminder({
      nowMs,
      isEveningWindow,
      hasActiveCounterSession: false,
      nearestPub: null,
      previousState: state,
    });
    await writeJson(PUB_REMINDER_STATE_KEY, decision.nextState);
    await configureLocationUpdates(decision.mode);
    return;
  }

  const coords = location.coords;
  await fetchPubsNear(coords.latitude, coords.longitude, undefined, {
    radiusKm: SEARCH_RADIUS_KM,
  });
  const pub = findNearestPub({
    lat: coords.latitude,
    lng: coords.longitude,
    maxKm: FIND_RADIUS_KM,
  });
  const nearestPub = pub
    ? {
        id: pub.id,
        name: pub.name,
        distanceMeters: haversineMeters(
          { lat: coords.latitude, lng: coords.longitude },
          { lat: pub.lat, lng: pub.lng },
        ),
      }
    : null;

  const decision = decidePubReminder({
    nowMs,
    isEveningWindow,
    hasActiveCounterSession: await hasActiveCounterSession(),
    nearestPub,
    previousState: state,
  });

  await writeJson(PUB_REMINDER_STATE_KEY, decision.nextState);
  if (decision.shouldNotify && decision.notificationPub) {
    await schedulePubReminder(decision.notificationPub.name);
  }
  await configureLocationUpdates(decision.mode);
}

TaskManager.defineTask(PUB_REMINDER_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locations = (data as LocationTaskData | undefined)?.locations ?? [];
  const latest = locations[locations.length - 1];
  if (!latest) return;
  await handleLocationSample(latest);
});

export async function initializePubReminderNotifications(): Promise<void> {
  await setAndroidChannel();
  const enabled = useSettingsStore.getState().pubReminderEnabled;
  await setReminderEnabled(enabled);
  if (!enabled) {
    await stopPubReminderNotifications();
    return;
  }

  const [notificationPermission, backgroundPermission] = await Promise.all([
    Notifications.getPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  if (notificationPermission.status !== 'granted' || backgroundPermission.status !== 'granted') {
    return;
  }

  void getAndRegisterPushToken(permissionStatus(notificationPermission.status));
  await configureLocationUpdates('hourly');
}

export async function enablePubReminderNotifications(): Promise<PubReminderEnableResult> {
  await setAndroidChannel();

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

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    await setReminderEnabled(false);
    return { ok: false, reason: 'foreground-location-denied' };
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    await setReminderEnabled(false);
    return { ok: false, reason: 'background-location-denied' };
  }

  await setReminderEnabled(true);
  void getAndRegisterPushToken(permissionStatus(notificationPermission.status));
  await configureLocationUpdates('hourly');
  return { ok: true };
}

export async function stopPubReminderNotifications(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(PUB_REMINDER_TASK_NAME);
  if (started) {
    await Location.stopLocationUpdatesAsync(PUB_REMINDER_TASK_NAME);
  }
}

export async function disablePubReminderNotifications(): Promise<void> {
  await setReminderEnabled(false);
  await stopPubReminderNotifications();
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    void disablePushDevice(token);
  } catch {
    void disablePushDevice();
  }
}
