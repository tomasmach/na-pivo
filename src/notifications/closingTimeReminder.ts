import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

import { decodeGeohash8, geohash8 } from '@/data/geohash';
import { fetchPubHours } from '@/data/hoursClient';
import { findNearbyPubs, type Pub } from '@/data/pubs';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { intlLocale, t } from '@/i18n';
import {
  ensureNotificationPermissionForBeerFeatures,
  type BeerCountReminderEnableResult,
} from '@/notifications/beerCountReminder';
import { planClosingReminder, type ClosingPlan } from '@/notifications/closingTimeModel';
import { distanceLabel } from '@/newlook/screens/kompas/format';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { useTallyStore, whenTallyHydrated, type TallySession } from '@/stores/tallyStore';

const STATE_KEY = 'na-pivo-closing-time-reminder';
const CHANNEL_ID = 'closing-time-reminders';
const CATEGORY_ID = 'closing-time-pubs';
const REMINDER_ID = 'closing-time-reminder';
const KIND = 'closing_time';
const ACTION_PREFIX = 'pub-';
const CANDIDATE_LIMIT = 15;
const CANDIDATE_RADIUS_KM = 2;
// Hours do not move during an evening; ask the server again only now and then.
const REFRESH_AFTER_MS = 15 * 60 * 1000;
// Lets a late start still ring right away without racing the scheduler.
const MIN_SCHEDULE_AHEAD_MS = 5 * 1000;

interface ReminderState {
  /** One evening in one pub rings at most once. */
  eveningKey: string;
  fireAtMs: number;
  signature: string;
}

export interface ClosingTimePub {
  key: string;
  name: string;
  lat: number;
  lng: number;
}

type NotificationsModule = typeof ExpoNotifications;
type NotificationResponse = ExpoNotifications.NotificationResponse;

function loadNotifications(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();
let installed = false;
let operationQueue: Promise<void> = Promise.resolve();
let lastLookup: { eveningKey: string; atMs: number; plan: ClosingPlan | null } | null = null;

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
      typeof value?.eveningKey !== 'string' ||
      typeof value.fireAtMs !== 'number' ||
      typeof value.signature !== 'string'
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
    // Best effort: a lost row can at worst ring once more for the same evening.
  }
}

async function cancelExisting(): Promise<void> {
  try {
    await Notifications?.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {
    // Already delivered or gone.
  }
  await writeState(null);
}

function eveningKeyFor(session: TallySession | null): string | null {
  if (!session || session.closedAt || isContextPubKey(session.pubKey)) return null;
  return `${session.clientId}|${session.pubKey}`;
}

async function notificationsGranted(): Promise<boolean> {
  try {
    return (await Notifications?.getPermissionsAsync())?.granted === true;
  } catch {
    return false;
  }
}

/**
 * Tonight's pub and the nearest pubs around it, with their hours, in one request.
 * Undefined means the answer is not known yet (no pubs loaded, no hours), so the
 * next sync asks again instead of waiting out the refresh interval.
 */
async function lookupPlan(session: TallySession): Promise<ClosingPlan | null | undefined> {
  const at = decodeGeohash8(session.pubKey);
  const nearby = findNearbyPubs({ lat: at.lat, lng: at.lng, limit: CANDIDATE_LIMIT + 1, maxKm: CANDIDATE_RADIUS_KM })
    .filter(({ pub }) => geohash8(pub.lat, pub.lng) !== session.pubKey)
    .slice(0, CANDIDATE_LIMIT);
  if (nearby.length === 0) return undefined;

  const current: Pub = { id: session.pubKey, name: session.pubName, lat: at.lat, lng: at.lng, city: session.pubCity };
  // Cache only: a reminder must not spend the scraping budget the pub pages use.
  const hours = await fetchPubHours([current, ...nearby.map(({ pub }) => pub)], undefined, { syncBudget: 0 });
  const currentHours = hours.get(current.id);
  if (!currentHours || currentHours.status === 'pending') return undefined;
  return planClosingReminder({
    nowMs: Date.now(),
    current: currentHours,
    candidates: nearby.flatMap(({ pub, distanceMeters }) => {
      const pubHours = hours.get(pub.id);
      if (!pubHours) return [];
      return [{
        key: geohash8(pub.lat, pub.lng),
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        distanceMeters,
        status: pubHours.status,
        isOpenNow: pubHours.isOpenNow,
        nextChange: pubHours.nextChange,
      }];
    }),
  });
}

function contentFor(session: TallySession, plan: ClosingPlan) {
  const hideNames = useSettingsStore.getState().hidePubNames;
  const time = new Date(plan.closesAtMs).toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' });
  const places = plan.alternatives.map((pub) => t.notifications.closingTimePlace(pub.name, distanceLabel(pub.distanceMeters)));
  return {
    title: t.notifications.closingTimeTitle(hideNames ? '' : session.pubName, time),
    body: hideNames
      ? t.notifications.closingTimeBodyHidden(plan.alternatives.length)
      : t.notifications.closingTimeBody(places),
    actions: plan.alternatives.map((pub) =>
      t.notifications.closingTimeAction(hideNames ? '' : pub.name, distanceLabel(pub.distanceMeters)),
    ),
    pubs: plan.alternatives.map(({ key, name, lat, lng }): ClosingTimePub => ({ key, name, lat, lng })),
  };
}

/** Keep exactly one closing-time ping for tonight's pub, or none. */
async function syncInternal(): Promise<void> {
  await Promise.all([waitForSettingsHydration(), whenTallyHydrated()]);
  const session = useTallyStore.getState().current;
  const eveningKey = eveningKeyFor(session);
  const existing = await readState();
  // This evening already got its ping; later lookups must not ring again.
  if (eveningKey && existing?.eveningKey === eveningKey && existing.fireAtMs <= Date.now()) return;

  const enabled = useSettingsStore.getState().closingTimeReminderEnabled;
  if (!enabled || !Notifications || !session || !eveningKey || !(await notificationsGranted())) {
    if (existing) await cancelExisting();
    return;
  }

  if (!lastLookup || lastLookup.eveningKey !== eveningKey || Date.now() - lastLookup.atMs > REFRESH_AFTER_MS) {
    const plan = await lookupPlan(session);
    lastLookup = plan === undefined ? null : { eveningKey, atMs: Date.now(), plan };
  }
  // The evening may have changed while the hours were loading.
  if (eveningKeyFor(useTallyStore.getState().current) !== eveningKey) return;
  const plan = lastLookup?.plan;
  if (!plan) {
    if (existing) await cancelExisting();
    return;
  }

  const content = contentFor(session, plan);
  const fireAtMs = Math.max(plan.fireAtMs, Date.now() + MIN_SCHEDULE_AHEAD_MS);
  const signature = JSON.stringify([plan.fireAtMs, content]);
  if (existing?.eveningKey === eveningKey && existing.signature === signature) return;

  await cancelExisting();
  try {
    await Notifications.setNotificationCategoryAsync(
      CATEGORY_ID,
      content.actions.map((buttonTitle, index) => ({
        identifier: `${ACTION_PREFIX}${index}`,
        buttonTitle,
        options: { opensAppToForeground: true },
      })),
    );
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: content.title,
        body: content.body,
        categoryIdentifier: CATEGORY_ID,
        data: { kind: KIND, pubs: content.pubs },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(fireAtMs),
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
    await writeState({ eveningKey, fireAtMs, signature });
  } catch {
    // The evening goes on without the ping.
  }
}

export function syncClosingTimeReminder(): Promise<void> {
  return serialize(syncInternal);
}

function validPub(value: unknown): ClosingTimePub | null {
  const { key, name, lat, lng } = (value ?? {}) as Record<string, unknown>;
  if (typeof key !== 'string' || !/^[0-9a-z]{8}$/.test(key)) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { key, name: typeof name === 'string' ? name : '', lat, lng };
}

/** The pub a closing-time button opens; a plain tap opens the nearest one. */
export function closingTimePub(response: NotificationResponse | null): ClosingTimePub | null {
  const data = response?.notification.request.content.data;
  if (data?.kind !== KIND || !Array.isArray(data.pubs)) return null;
  const action = response?.actionIdentifier ?? '';
  const index = action.startsWith(ACTION_PREFIX) ? Number(action.slice(ACTION_PREFIX.length)) : 0;
  return Number.isInteger(index) ? validPub(data.pubs[index]) : null;
}

export function subscribeClosingTimeTap(onTap: (pub: ClosingTimePub) => void): ExpoNotifications.Subscription {
  if (!Notifications) return { remove: () => undefined };
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const pub = closingTimePub(response);
    if (pub) onTap(pub);
  });
}

export async function consumeInitialClosingTimeTap(onTap: (pub: ClosingTimePub) => void): Promise<void> {
  if (!Notifications) return;
  try {
    const pub = closingTimePub(await Notifications.getLastNotificationResponseAsync());
    if (!pub) return;
    await Notifications.clearLastNotificationResponseAsync();
    onTap(pub);
  } catch {
    // No launch notification, or the API is unavailable.
  }
}

async function setAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: t.notifications.closingTimeChannel,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {
    // Scheduling falls back to the default channel.
  }
}

/** Turn the reminder on from settings; this is the only place it asks for permission. */
export async function enableClosingTimeReminder(): Promise<BeerCountReminderEnableResult> {
  await setAndroidChannel();
  const permission = await ensureNotificationPermissionForBeerFeatures();
  useSettingsStore.getState().setClosingTimeReminderEnabled(permission.ok);
  return permission;
}

export function disableClosingTimeReminder(): void {
  useSettingsStore.getState().setClosingTimeReminderEnabled(false);
}

/** Follow tonight's pub, the setting and foregrounds. Safe to call more than once. */
export function initializeClosingTimeReminder(): void {
  if (installed) return;
  installed = true;
  void setAndroidChannel();
  // Every count is a cheap retry when the pubs around were not loaded yet.
  useTallyStore.subscribe((state, previous) => {
    if (state.current !== previous.current) void syncClosingTimeReminder();
  });
  useSettingsStore.subscribe((state, previous) => {
    if (
      state.closingTimeReminderEnabled !== previous.closingTimeReminderEnabled ||
      state.hidePubNames !== previous.hidePubNames
    ) {
      void syncClosingTimeReminder();
    }
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void syncClosingTimeReminder();
  });
  void syncClosingTimeReminder();
}
