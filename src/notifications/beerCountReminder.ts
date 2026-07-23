import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

import { normalizeDrinkType } from '@/drinks/drinkTypes';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

const BEER_COUNT_REMINDER_STATE_KEY = 'na-pivo-beer-count-reminder-state';
const BEER_COUNT_REMINDER_CHANNEL_ID = 'beer-count-reminders';
export const BEER_COUNT_REMINDER_KIND = 'beer_count_reminder';

interface BeerCountReminderState {
  notificationId: string;
  sessionId: string;
  fireAtMs: number;
}

export type BeerCountReminderEnableResult =
  | { ok: true }
  | { ok: false; reason: 'notifications-denied' | 'unavailable' };

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
let tallySubscriptionInstalled = false;
let operationQueue: Promise<void> = Promise.resolve();
let permissionRequest: Promise<BeerCountReminderEnableResult> | null = null;
const handledTapIds = new Set<string>();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function sessionHasBeer(session: TallySession | null | undefined): session is TallySession {
  return !!session?.drinks.some((drink) => normalizeDrinkType(drink.drinkType) === 'beer');
}

function activeSessionMatches(sessionId: string): boolean {
  const current = useTallyStore.getState().current;
  return current?.clientId === sessionId && sessionHasBeer(current);
}

async function readState(): Promise<BeerCountReminderState | null> {
  try {
    const raw = await AsyncStorage.getItem(BEER_COUNT_REMINDER_STATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<BeerCountReminderState>;
    if (
      typeof value.notificationId !== 'string' ||
      typeof value.sessionId !== 'string' ||
      typeof value.fireAtMs !== 'number' ||
      !Number.isFinite(value.fireAtMs)
    ) {
      return null;
    }
    return value as BeerCountReminderState;
  } catch {
    return null;
  }
}

async function writeState(state: BeerCountReminderState | null): Promise<void> {
  try {
    if (state) {
      await AsyncStorage.setItem(BEER_COUNT_REMINDER_STATE_KEY, JSON.stringify(state));
    } else {
      await AsyncStorage.removeItem(BEER_COUNT_REMINDER_STATE_KEY);
    }
  } catch {
    // Best effort: a missing bookkeeping row can only stop the reminder chain.
  }
}

async function setAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(BEER_COUNT_REMINDER_CHANNEL_ID, {
      name: 'Připomínky počítadla',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
      lightColor: '#f6c45c',
    });
  } catch {
    // Scheduling below remains the source of truth for actual availability.
  }
}

async function ensurePermissionInternal(): Promise<BeerCountReminderEnableResult> {
  if (!Notifications) return { ok: false, reason: 'unavailable' };
  try {
    await setAndroidChannel();

    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') return { ok: true };
    if (current.status === 'denied') return { ok: false, reason: 'notifications-denied' };

    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: false,
      },
    });
    return requested.status === 'granted'
      ? { ok: true }
      : { ok: false, reason: 'notifications-denied' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Share one OS permission request across the reminder and Android Live Update. */
export function ensureNotificationPermissionForBeerFeatures(): Promise<
  BeerCountReminderEnableResult
> {
  if (permissionRequest) return permissionRequest;
  permissionRequest = ensurePermissionInternal().finally(() => {
    permissionRequest = null;
  });
  return permissionRequest;
}

async function cancelInternal(expectedSessionId?: string): Promise<void> {
  const state = await readState();
  if (!state || (expectedSessionId && state.sessionId !== expectedSessionId)) return;

  if (Notifications) {
    try {
      await Notifications.cancelScheduledNotificationAsync(state.notificationId);
    } catch {
      // The notification may already have fired. State still needs clearing.
    }
  }
  await writeState(null);
}

async function scheduleInternal(
  sessionId: string,
  options: { replaceExisting: boolean },
): Promise<BeerCountReminderEnableResult> {
  await waitForSettingsHydration();
  const settings = useSettingsStore.getState();
  if (!settings.beerCountReminderEnabled) return { ok: true };
  if (!activeSessionMatches(sessionId)) return { ok: true };

  const existing = await readState();
  if (existing && existing.sessionId === sessionId && !options.replaceExisting) {
    return { ok: true };
  }
  if (existing) await cancelInternal();

  const permission = await ensureNotificationPermissionForBeerFeatures();
  if (!permission.ok) {
    useSettingsStore.getState().setBeerCountReminderEnabled(false);
    return permission;
  }
  if (!Notifications) return { ok: false, reason: 'unavailable' };

  const intervalMinutes = useSettingsStore.getState().beerCountReminderIntervalMinutes;
  const seconds = intervalMinutes * 60;
  const fireAtMs = Date.now() + seconds * 1000;
  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Nezapomněl sis zapsat pivko?',
        body: 'Klepni a přidej další čárku do počítadla.',
        data: {
          kind: BEER_COUNT_REMINDER_KIND,
          sessionId,
          fireAtMs,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
        ...(Platform.OS === 'android' ? { channelId: BEER_COUNT_REMINDER_CHANNEL_ID } : {}),
      },
    });

    await writeState({ notificationId, sessionId, fireAtMs });
    return { ok: true };
  } catch {
    useSettingsStore.getState().setBeerCountReminderEnabled(false);
    return { ok: false, reason: 'unavailable' };
  }
}

/** Keep one reminder scheduled relative to the latest beer of this evening. */
export function refreshBeerCountReminderAfterBeer(
  sessionId: string,
): Promise<BeerCountReminderEnableResult> {
  return serialize(() => scheduleInternal(sessionId, { replaceExisting: true }));
}

/** Enable the preference and start a reminder for an already-active evening. */
export function enableBeerCountReminderNotifications(): Promise<BeerCountReminderEnableResult> {
  return serialize(async () => {
    useSettingsStore.getState().setBeerCountReminderEnabled(true);
    const permission = await ensureNotificationPermissionForBeerFeatures();
    if (!permission.ok) {
      useSettingsStore.getState().setBeerCountReminderEnabled(false);
      return permission;
    }

    const current = useTallyStore.getState().current;
    if (sessionHasBeer(current)) {
      return scheduleInternal(current.clientId, { replaceExisting: false });
    }
    return { ok: true };
  });
}

export function disableBeerCountReminderNotifications(): Promise<void> {
  return serialize(async () => {
    useSettingsStore.getState().setBeerCountReminderEnabled(false);
    await cancelInternal();
  });
}

/** Apply a changed interval only to a reminder that has not fired yet. */
export function reschedulePendingBeerCountReminder(): Promise<void> {
  return serialize(async () => {
    const state = await readState();
    if (!state || state.fireAtMs <= Date.now()) return;
    if (!activeSessionMatches(state.sessionId)) {
      await cancelInternal(state.sessionId);
      return;
    }
    await cancelInternal(state.sessionId);
    await scheduleInternal(state.sessionId, { replaceExisting: true });
  });
}

export function isBeerCountReminderResponse(
  response: ExpoNotifications.NotificationResponse | null,
): boolean {
  return response?.notification.request.content.data?.kind === BEER_COUNT_REMINDER_KIND;
}

function claimTap(response: ExpoNotifications.NotificationResponse): boolean {
  const id = response.notification.request.identifier;
  if (handledTapIds.has(id)) return false;
  if (handledTapIds.size >= 32) handledTapIds.clear();
  handledTapIds.add(id);
  return true;
}

async function rearmFromTap(
  response: ExpoNotifications.NotificationResponse,
): Promise<void> {
  await waitForSettingsHydration();
  if (!useSettingsStore.getState().beerCountReminderEnabled) return;

  const tappedNotificationId = response.notification.request.identifier;
  const state = await readState();
  // A response can surface through both the cold-start read and the live event.
  // Only the notification currently recorded for this chain may re-arm it.
  if (!state || state.notificationId !== tappedNotificationId) return;
  if (!activeSessionMatches(state.sessionId)) {
    await cancelInternal(state.sessionId);
    return;
  }

  await cancelInternal(state.sessionId);
  await scheduleInternal(state.sessionId, { replaceExisting: true });
}

export function subscribeBeerCountReminderTap(
  onTap: () => void,
): ExpoNotifications.Subscription {
  if (!Notifications) return { remove: () => undefined };
  try {
    return Notifications.addNotificationResponseReceivedListener((response) => {
      if (!isBeerCountReminderResponse(response) || !claimTap(response)) return;
      onTap();
      void serialize(() => rearmFromTap(response));
    });
  } catch {
    return { remove: () => undefined };
  }
}

export async function consumeInitialBeerCountReminderTap(onTap: () => void): Promise<void> {
  if (!Notifications) return;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!isBeerCountReminderResponse(response) || !response) return;
    if (claimTap(response)) {
      onTap();
      await serialize(() => rearmFromTap(response));
    }
    await Notifications.clearLastNotificationResponseAsync();
  } catch {
    // A missing/old launch response must never block app startup.
  }
}

/**
 * Install lifecycle cleanup once. Ending, emptying, or replacing an evening
 * cancels its still-pending reminder; a delivered ignored reminder stays inert.
 */
export async function initializeBeerCountReminderNotifications(): Promise<void> {
  await waitForSettingsHydration();
  await setAndroidChannel();

  await serialize(async () => {
    const state = await readState();
    if (
      state &&
      (!useSettingsStore.getState().beerCountReminderEnabled ||
        !activeSessionMatches(state.sessionId))
    ) {
      await cancelInternal(state.sessionId);
    }
  });

  if (tallySubscriptionInstalled) return;
  tallySubscriptionInstalled = true;
  useTallyStore.subscribe((state, previousState) => {
    const previous = previousState.current;
    if (!sessionHasBeer(previous)) return;
    const current = state.current;
    if (current?.clientId !== previous.clientId || !sessionHasBeer(current)) {
      void serialize(() => cancelInternal(previous.clientId));
    }
  });
}
