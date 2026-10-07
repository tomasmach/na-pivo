import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

import { t } from '@/i18n';
import {
  ensureNotificationPermissionForBeerFeatures,
  type BeerCountReminderEnableResult,
} from '@/notifications/beerCountReminder';
import { useHomeTransitStore, waitForHomeTransitHydration } from '@/stores/homeTransitStore';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { whenTallyHydrated } from '@/stores/tallyStore';
import { formatDepartureTime, isUpcomingDeparture } from '@/transit/homeTransit';
import { homeTransitForCurrentEvening } from '@/transit/homeTransitSync';

const STATE_KEY = 'na-pivo-home-transit-reminder';
const CHANNEL_ID = 'home-transit-reminders';
const HOME_TRANSIT_REMINDER_KIND = 'home_transit_reminder';
/** How long before the departure the reminder rings. */
export const HOME_TRANSIT_REMINDER_LEAD_MS = 20 * 60 * 1000;
// Closer than this to the reminder time there is nothing useful left to say.
const MIN_SCHEDULE_AHEAD_MS = 30 * 1000;

interface ReminderState {
  notificationId: string;
  lookupKey: string;
  departsAtMs: number;
  /** What the ping says; a different text (line, stop, hidden pub names) replans it. */
  body?: string;
}

type NotificationsModule = typeof ExpoNotifications;

function loadNotifications(): NotificationsModule | null {
  try {
    // Keep local builds without the native notification module usable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();
let installed = false;
let operationQueue: Promise<void> = Promise.resolve();

function serialize(operation: () => Promise<void>): Promise<void> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.catch(() => undefined);
  return result;
}

async function readState(): Promise<ReminderState | null> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<ReminderState> | null) : null;
    if (
      typeof value?.notificationId !== 'string' ||
      typeof value.lookupKey !== 'string' ||
      typeof value.departsAtMs !== 'number'
    ) {
      return null;
    }
    return value as ReminderState;
  } catch {
    return null;
  }
}

async function writeState(state: ReminderState | null): Promise<void> {
  try {
    if (state) await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
    else await AsyncStorage.removeItem(STATE_KEY);
  } catch {
    // Best effort: a lost row can at worst leave one stale reminder behind.
  }
}

async function cancelExisting(): Promise<void> {
  const state = await readState();
  if (!state) return;
  try {
    await Notifications?.cancelScheduledNotificationAsync(state.notificationId);
  } catch {
    // Already delivered or gone; the bookkeeping still has to go.
  }
  await writeState(null);
}

/** Keep exactly one reminder for tonight's connection, or none. */
async function syncInternal(): Promise<void> {
  await Promise.all([
    waitForSettingsHydration(),
    waitForHomeTransitHydration(),
    whenTallyHydrated(),
  ]);
  const { lookupKey } = useHomeTransitStore.getState();
  const departure = homeTransitForCurrentEvening();
  const enabled = useSettingsStore.getState().homeTransitReminderEnabled;
  const valid = enabled && !!Notifications && !!lookupKey && isUpcomingDeparture(departure);
  const body = departure
    ? t.notifications.homeTransitBody(
        departure.line,
        formatDepartureTime(departure.departsAtMs),
        // Same rule as the Live Activity: the stop would give the pub away.
        useSettingsStore.getState().hidePubNames ? '' : departure.fromStopName,
      )
    : '';

  const existing = await readState();
  // An already planned ping for the same ride and text stays, however close it is.
  if (
    valid &&
    existing?.lookupKey === lookupKey &&
    existing.departsAtMs === departure?.departsAtMs &&
    existing.body === body
  ) {
    return;
  }
  await cancelExisting();
  const fireAtMs = departure ? departure.departsAtMs - HOME_TRANSIT_REMINDER_LEAD_MS : 0;
  if (!valid || !Notifications || !departure || !lookupKey) return;
  if (fireAtMs - Date.now() <= MIN_SCHEDULE_AHEAD_MS) return;

  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: t.notifications.homeTransitTitle,
        body,
        data: { kind: HOME_TRANSIT_REMINDER_KIND },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(fireAtMs),
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
    await writeState({ notificationId, lookupKey, departsAtMs: departure.departsAtMs, body });
  } catch {
    // The connection still shows in the evening; only the ping is missing.
  }
}

export function syncHomeTransitReminder(): Promise<void> {
  return serialize(syncInternal);
}

async function setAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: t.notifications.homeTransitChannel,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // Scheduling falls back to the default channel.
  }
}

/** Turn the reminder on; it asks for notification permission once. */
export async function enableHomeTransitReminder(): Promise<BeerCountReminderEnableResult> {
  await setAndroidChannel();
  const permission = await ensureNotificationPermissionForBeerFeatures();
  useSettingsStore.getState().setHomeTransitReminderEnabled(permission.ok);
  return permission;
}

export function disableHomeTransitReminder(): void {
  useSettingsStore.getState().setHomeTransitReminderEnabled(false);
}

/** Follow tonight's connection and the setting. Safe to call more than once. */
export function initializeHomeTransitReminder(): void {
  if (installed) return;
  installed = true;
  void setAndroidChannel();
  useHomeTransitStore.subscribe((state, previous) => {
    if (state.departure !== previous.departure || state.lookupKey !== previous.lookupKey) {
      void syncHomeTransitReminder();
    }
  });
  useSettingsStore.subscribe((state, previous) => {
    if (
      state.homeTransitReminderEnabled !== previous.homeTransitReminderEnabled ||
      state.hidePubNames !== previous.hidePubNames
    ) {
      void syncHomeTransitReminder();
    }
  });
  void syncHomeTransitReminder();
}
