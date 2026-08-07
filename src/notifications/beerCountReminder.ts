import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

import {
  PrivateAccountMutationFrozenError,
  capturePrivateAccountMutationScope,
  isPrivateAccountMutationScopeCurrent,
  runPrivateAccountMutation,
  type PrivateAccountMutationScope,
} from '@/data/privateAccountBoundary';
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

function assertCurrentScope(scope: PrivateAccountMutationScope): void {
  if (!isPrivateAccountMutationScopeCurrent(scope)) {
    throw new PrivateAccountMutationFrozenError();
  }
}

/** Capture the global account lease before waiting behind the reminder mutex. */
function serialize<T>(operation: (scope: PrivateAccountMutationScope) => Promise<T>): Promise<T> {
  const previous = operationQueue;
  const result = runPrivateAccountMutation(async (scope) => {
    await previous;
    assertCurrentScope(scope);
    const value = await operation(scope);
    assertCurrentScope(scope);
    return value;
  });
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function ignoreFrozen(result: Promise<void>): Promise<void> {
  return result.catch((error: unknown) => {
    if (!(error instanceof PrivateAccountMutationFrozenError)) throw error;
  });
}

function unavailableWhenFrozen(
  result: Promise<BeerCountReminderEnableResult>,
): Promise<BeerCountReminderEnableResult> {
  return result.catch((error: unknown) => {
    if (error instanceof PrivateAccountMutationFrozenError) {
      return { ok: false, reason: 'unavailable' };
    }
    throw error;
  });
}

function sessionHasBeer(session: TallySession | null | undefined): session is TallySession {
  return !!session?.drinks.some((drink) => normalizeDrinkType(drink.drinkType) === 'beer');
}

function activeSessionMatches(sessionId: string): boolean {
  const current = useTallyStore.getState().current;
  return current?.clientId === sessionId && sessionHasBeer(current);
}

function parseState(raw: string | null): BeerCountReminderState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BeerCountReminderState>;
    return typeof value.notificationId === 'string' &&
      typeof value.sessionId === 'string' &&
      typeof value.fireAtMs === 'number' &&
      Number.isFinite(value.fireAtMs)
      ? (value as BeerCountReminderState)
      : null;
  } catch {
    return null;
  }
}

async function readState(scope: PrivateAccountMutationScope): Promise<BeerCountReminderState | null> {
  assertCurrentScope(scope);
  const raw = await AsyncStorage.getItem(BEER_COUNT_REMINDER_STATE_KEY);
  assertCurrentScope(scope);
  return parseState(raw);
}

async function writeState(
  scope: PrivateAccountMutationScope,
  state: BeerCountReminderState | null,
): Promise<void> {
  assertCurrentScope(scope);
  if (state) {
    const serialized = JSON.stringify(state);
    await AsyncStorage.setItem(BEER_COUNT_REMINDER_STATE_KEY, serialized);
    assertCurrentScope(scope);
    if ((await AsyncStorage.getItem(BEER_COUNT_REMINDER_STATE_KEY)) !== serialized) {
      throw new Error('Could not persist the beer-count reminder state.');
    }
  } else {
    await AsyncStorage.removeItem(BEER_COUNT_REMINDER_STATE_KEY);
    assertCurrentScope(scope);
    if ((await AsyncStorage.getItem(BEER_COUNT_REMINDER_STATE_KEY)) !== null) {
      throw new Error('Could not clear the beer-count reminder state.');
    }
  }
  assertCurrentScope(scope);
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
  return unavailableWhenFrozen(
    runPrivateAccountMutation(async (scope) => {
      if (!permissionRequest) {
        permissionRequest = ensurePermissionInternal().finally(() => {
          permissionRequest = null;
        });
      }
      const result = await permissionRequest;
      assertCurrentScope(scope);
      return result;
    }),
  );
}

async function cancelScheduledNotificationBestEffort(notificationId: string): Promise<void> {
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // It may already have fired or been removed by strict boundary cleanup.
  }
}

async function removeLateState(notificationId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(BEER_COUNT_REMINDER_STATE_KEY);
    if (parseState(raw)?.notificationId !== notificationId) return;
    await AsyncStorage.removeItem(BEER_COUNT_REMINDER_STATE_KEY);
  } catch {
    // The strict cleanup performs a verified remove after this lease drains.
  }
}

async function cancelInternal(
  scope: PrivateAccountMutationScope,
  expectedSessionId?: string,
): Promise<void> {
  const state = await readState(scope);
  if (!state || (expectedSessionId && state.sessionId !== expectedSessionId)) return;

  await cancelScheduledNotificationBestEffort(state.notificationId);
  assertCurrentScope(scope);
  await writeState(scope, null);
}

async function scheduleInternal(
  scope: PrivateAccountMutationScope,
  sessionId: string,
  options: { replaceExisting: boolean },
): Promise<BeerCountReminderEnableResult> {
  await waitForSettingsHydration();
  assertCurrentScope(scope);
  const settings = useSettingsStore.getState();
  if (!settings.beerCountReminderEnabled) return { ok: true };
  if (!activeSessionMatches(sessionId)) return { ok: true };

  const existing = await readState(scope);
  if (existing && existing.sessionId === sessionId && !options.replaceExisting) {
    return { ok: true };
  }
  if (existing) await cancelInternal(scope);

  if (!permissionRequest) {
    permissionRequest = ensurePermissionInternal().finally(() => {
      permissionRequest = null;
    });
  }
  const permission = await permissionRequest;
  assertCurrentScope(scope);
  if (!permission.ok) {
    useSettingsStore.getState().setBeerCountReminderEnabled(false);
    return permission;
  }
  if (!Notifications) return { ok: false, reason: 'unavailable' };

  const intervalMinutes = useSettingsStore.getState().beerCountReminderIntervalMinutes;
  const seconds = intervalMinutes * 60;
  const fireAtMs = Date.now() + seconds * 1000;
  let notificationId: string | null = null;
  try {
    notificationId = await Notifications.scheduleNotificationAsync({
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

    if (!isPrivateAccountMutationScopeCurrent(scope)) {
      await cancelScheduledNotificationBestEffort(notificationId);
      throw new PrivateAccountMutationFrozenError();
    }
    await writeState(scope, { notificationId, sessionId, fireAtMs });
    return { ok: true };
  } catch (error) {
    if (notificationId) {
      await cancelScheduledNotificationBestEffort(notificationId);
      await removeLateState(notificationId);
    }
    if (
      error instanceof PrivateAccountMutationFrozenError ||
      !isPrivateAccountMutationScopeCurrent(scope)
    ) {
      throw new PrivateAccountMutationFrozenError();
    }
    useSettingsStore.getState().setBeerCountReminderEnabled(false);
    return { ok: false, reason: 'unavailable' };
  }
}

/** Keep one reminder scheduled relative to the latest beer of this evening. */
export function refreshBeerCountReminderAfterBeer(
  sessionId: string,
): Promise<BeerCountReminderEnableResult> {
  return unavailableWhenFrozen(
    serialize((scope) => scheduleInternal(scope, sessionId, { replaceExisting: true })),
  );
}

/** Enable the preference and start a reminder for an already-active evening. */
export function enableBeerCountReminderNotifications(): Promise<BeerCountReminderEnableResult> {
  return unavailableWhenFrozen(serialize(async (scope) => {
    useSettingsStore.getState().setBeerCountReminderEnabled(true);
    if (!permissionRequest) {
      permissionRequest = ensurePermissionInternal().finally(() => {
        permissionRequest = null;
      });
    }
    const permission = await permissionRequest;
    assertCurrentScope(scope);
    if (!permission.ok) {
      useSettingsStore.getState().setBeerCountReminderEnabled(false);
      return permission;
    }

    const current = useTallyStore.getState().current;
    if (sessionHasBeer(current)) {
      return scheduleInternal(scope, current.clientId, { replaceExisting: false });
    }
    return { ok: true };
  }));
}

export function disableBeerCountReminderNotifications(): Promise<void> {
  return ignoreFrozen(serialize(async (scope) => {
    useSettingsStore.getState().setBeerCountReminderEnabled(false);
    await cancelInternal(scope);
  }));
}

/** Apply a changed interval only to a reminder that has not fired yet. */
export function reschedulePendingBeerCountReminder(): Promise<void> {
  return ignoreFrozen(serialize(async (scope) => {
    const state = await readState(scope);
    if (!state || state.fireAtMs <= Date.now()) return;
    if (!activeSessionMatches(state.sessionId)) {
      await cancelInternal(scope, state.sessionId);
      return;
    }
    await cancelInternal(scope, state.sessionId);
    await scheduleInternal(scope, state.sessionId, { replaceExisting: true });
  }));
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
  scope: PrivateAccountMutationScope,
): Promise<void> {
  await waitForSettingsHydration();
  assertCurrentScope(scope);
  if (!useSettingsStore.getState().beerCountReminderEnabled) return;

  const tappedNotificationId = response.notification.request.identifier;
  const state = await readState(scope);
  // A response can surface through both the cold-start read and the live event.
  // Only the notification currently recorded for this chain may re-arm it.
  if (!state || state.notificationId !== tappedNotificationId) return;
  if (!activeSessionMatches(state.sessionId)) {
    await cancelInternal(scope, state.sessionId);
    return;
  }

  await cancelInternal(scope, state.sessionId);
  await scheduleInternal(scope, state.sessionId, { replaceExisting: true });
}

export function subscribeBeerCountReminderTap(
  onTap: () => void,
): ExpoNotifications.Subscription {
  if (!Notifications) return { remove: () => undefined };
  try {
    return Notifications.addNotificationResponseReceivedListener((response) => {
      const invocationScope = capturePrivateAccountMutationScope();
      if (!isPrivateAccountMutationScopeCurrent(invocationScope)) return;
      if (!isBeerCountReminderResponse(response) || !claimTap(response)) return;
      onTap();
      void ignoreFrozen(serialize((scope) => rearmFromTap(response, scope))).catch(
        () => undefined,
      );
    });
  } catch {
    return { remove: () => undefined };
  }
}

export async function consumeInitialBeerCountReminderTap(onTap: () => void): Promise<void> {
  if (!Notifications) return;
  try {
    await ignoreFrozen(serialize(async (scope) => {
      const response = await Notifications.getLastNotificationResponseAsync();
      assertCurrentScope(scope);
      if (!isBeerCountReminderResponse(response) || !response) return;
      if (claimTap(response)) {
        onTap();
        await rearmFromTap(response, scope);
      }
      assertCurrentScope(scope);
      await Notifications.clearLastNotificationResponseAsync();
      assertCurrentScope(scope);
    }));
  } catch {
    // A missing/old launch response must never block app startup.
  }
}

/**
 * Install lifecycle cleanup once. Ending, emptying, or replacing an evening
 * cancels its still-pending reminder; a delivered ignored reminder stays inert.
 */
export async function initializeBeerCountReminderNotifications(): Promise<void> {
  await ignoreFrozen(serialize(async (scope) => {
    await waitForSettingsHydration();
    assertCurrentScope(scope);
    await setAndroidChannel();
    assertCurrentScope(scope);

    const state = await readState(scope);
    if (
      state &&
      (!useSettingsStore.getState().beerCountReminderEnabled ||
        !activeSessionMatches(state.sessionId))
    ) {
      await cancelInternal(scope, state.sessionId);
    }
  }));

  if (tallySubscriptionInstalled) return;
  tallySubscriptionInstalled = true;
  useTallyStore.subscribe((state, previousState) => {
    const previous = previousState.current;
    if (!sessionHasBeer(previous)) return;
    const current = state.current;
    if (current?.clientId !== previous.clientId || !sessionHasBeer(current)) {
      void ignoreFrozen(
        serialize((scope) => cancelInternal(scope, previous.clientId)),
      ).catch(() => undefined);
    }
  });
}

function isScheduledBeerReminder(request: ExpoNotifications.NotificationRequest): boolean {
  return request.content.data?.kind === BEER_COUNT_REMINDER_KIND;
}

/**
 * Strict account-boundary cleanup. It intentionally leaves the device-level
 * enable/interval preferences untouched while removing A's scheduled OS work
 * and the session-bearing bookkeeping row with readback verification.
 */
export async function clearBeerCountReminderForAccountBoundary(): Promise<boolean> {
  await operationQueue;

  let success = true;
  let rawState: string | null = null;
  try {
    rawState = await AsyncStorage.getItem(BEER_COUNT_REMINDER_STATE_KEY);
  } catch {
    success = false;
  }

  const notificationIds = new Set<string>();
  const state = parseState(rawState);
  if (state) notificationIds.add(state.notificationId);

  if (!Notifications && (Platform.OS === 'ios' || Platform.OS === 'android')) {
    success = false;
  } else if (Notifications) {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const request of scheduled) {
        if (isScheduledBeerReminder(request)) notificationIds.add(request.identifier);
      }
    } catch {
      // The final enumeration below is authoritative. The recorded ID can
      // still be cancelled when an initial listing is briefly unavailable.
    }

    for (const notificationId of notificationIds) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch {
        // Already-fired/absent IDs can reject; final readback decides safety.
      }
    }

    try {
      const remaining = await Notifications.getAllScheduledNotificationsAsync();
      if (remaining.some(isScheduledBeerReminder)) success = false;
    } catch {
      success = false;
    }
  }

  try {
    await AsyncStorage.removeItem(BEER_COUNT_REMINDER_STATE_KEY);
    if ((await AsyncStorage.getItem(BEER_COUNT_REMINDER_STATE_KEY)) !== null) {
      success = false;
    }
  } catch {
    success = false;
  }

  return success;
}
