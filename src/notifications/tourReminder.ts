import { Platform } from 'react-native';
import type * as ExpoNotifications from 'expo-notifications';

import { intlLocale, t } from '@/i18n';
import { ensureNotificationPermissionForBeerFeatures } from '@/notifications/beerCountReminder';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { useToursStore } from '@/stores/toursStore';
import type { TourPlan, TourRun } from '@/tours/model';

export const TOUR_REMINDER_KIND = 'tour_reminder';
const TOUR_REMINDER_CHANNEL_ID = 'tour-meetups';
const ID_PREFIX = 'tour-reminder-';
/** On iOS, leaves most of the 64 pending notifications to the pub and beer reminders. */
const MAX_PENDING = 20;
const HOUR_MS = 3600000;

type NotificationsModule = typeof ExpoNotifications;
type PlanTime = Pick<TourPlan, 'scheduledDate' | 'scheduledTime' | 'timezone'>;

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

function zonedParts(ms: number, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]));
}

/** The instant a wall-clock time happens in `timeZone`, or null when that time does not exist there. */
export function zonedInstant(date: string, time: string, timeZone: string): number | null {
  const wall = `${date}T${time}:00`;
  const target = Date.parse(`${wall}Z`);
  if (!Number.isFinite(target)) return null;
  try {
    let candidate = target;
    for (let attempt = 0; attempt < 3; attempt++) {
      const p = zonedParts(candidate, timeZone);
      const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
      if (local === wall) return candidate;
      candidate += target - Date.parse(`${local}Z`);
    }
  } catch {
    // An unknown time zone has no instant to offer.
  }
  return null;
}

function zonedDate(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * When the meetup reminder fires: two hours ahead, not before eight in the morning;
 * a day without a time reminds at noon. Always the plan's own wall clock.
 */
export function tourReminderAt(plan: PlanTime): number | null {
  if (!plan.scheduledDate) return null;
  if (!plan.scheduledTime) return zonedInstant(plan.scheduledDate, '12:00', plan.timezone);
  const meetup = zonedInstant(plan.scheduledDate, plan.scheduledTime, plan.timezone);
  if (meetup === null) return null;
  const early = meetup - 2 * HOUR_MS;
  const floor = zonedInstant(plan.scheduledDate, '08:00', plan.timezone);
  if (floor !== null && floor < meetup) return Math.max(early, floor);
  // A meetup at eight or earlier keeps its two hours, but still on its own day.
  const midnight = zonedInstant(plan.scheduledDate, '00:00', plan.timezone);
  return midnight === null ? early : Math.max(early, midnight);
}

export interface TourReminder {
  planId: string;
  fireAtMs: number;
  title: string;
  body: string;
}

/** The reminder a plan should have now, or null once it passed, has no date or is already being walked. */
export function tourReminderFor(
  plan: TourPlan,
  runs: { activeRun: TourRun | null; runs: TourRun[] },
  now = Date.now(),
): TourReminder | null {
  const fireAtMs = tourReminderAt(plan);
  if (fireAtMs === null || fireAtMs <= now) return null;
  if (runs.activeRun?.planId === plan.id) return null;
  // A walk of this plan on its meetup day means the group already met.
  if (runs.runs.some((run) => run.planId === plan.id && zonedDate(Date.parse(run.startedAt), plan.timezone) === plan.scheduledDate)) {
    return null;
  }
  const pub = plan.stops[0]?.name ?? '';
  return {
    planId: plan.id,
    fireAtMs,
    title: t.tourReminders.title(plan.title),
    body: plan.scheduledTime
      ? t.tourReminders.bodyAt(t.tourReminders.at(plan.scheduledTime), pub)
      : t.tourReminders.bodyToday(pub),
  };
}

/** „Mám ti v pátek v 17:00 připomenout sraz?“ in the plan's own wall clock; the time is when the reminder comes, not the meetup. */
export function tourReminderAskText(plan: TourPlan, fireAtMs: number, now = Date.now()): string {
  const date = zonedDate(fireAtMs, plan.timezone);
  const p = zonedParts(fireAtMs, plan.timezone);
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${zonedDate(now, plan.timezone)}T12:00:00Z`)) / (24 * HOUR_MS));
  const weekday = t.tourReminders.onDay[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
  const when = days <= 0 ? t.tourReminders.today
    : days <= 6 ? weekday
      : `${weekday} ${new Date(`${date}T12:00:00Z`).toLocaleDateString(intlLocale, { day: 'numeric', month: 'numeric', timeZone: 'UTC' })}`;
  return t.tourReminders.ask(when, t.tourReminders.at(`${p.hour}:${p.minute}`));
}

function desiredReminders(now: number): TourReminder[] {
  const tours = useToursStore.getState();
  // Not hydrated means no plans this phone may show: at start or right after an account change.
  if (!tours.hydrated) return [];
  // iOS keeps 64 pending local notifications for the whole app; there the nearest meetups get the slots and later ones follow on the next pass.
  return tours.plans.flatMap((plan) => tourReminderFor(plan, tours, now) ?? [])
    .sort((a, b) => a.fireAtMs - b.fireAtMs)
    .slice(0, Platform.OS === 'ios' ? MAX_PENDING : undefined);
}

/** A reminder already on screen goes once it no longer tells the truth: plan gone or moved, walk started, reminders off, account switched. */
async function dismissOutdated(): Promise<void> {
  if (!Notifications?.getPresentedNotificationsAsync) return;
  const tours = useToursStore.getState();
  const plans = new Map(tours.hydrated ? tours.plans.map((plan) => [`${ID_PREFIX}${plan.id}`, plan]) : []);
  const enabled = useSettingsStore.getState().tourRemindersEnabled;
  try {
    for (const shown of await Notifications.getPresentedNotificationsAsync()) {
      const id = shown.request.identifier;
      if (!id.startsWith(ID_PREFIX)) continue;
      const plan = plans.get(id);
      // Zero skips the "already passed" check: a delivered reminder has passed by definition.
      const current = enabled && plan ? tourReminderFor(plan, tours, 0) : null;
      // It says "today" and names the tour and first pub, so it stays only on its day and while that text still holds.
      const stillTrue = current && plan && current.fireAtMs === shown.request.content.data?.fireAtMs &&
        current.title === shown.request.content.title && current.body === shown.request.content.body &&
        zonedDate(Date.now(), plan.timezone) === plan.scheduledDate;
      if (stillTrue) continue;
      await Notifications.dismissNotificationAsync(id).catch(() => undefined);
    }
  } catch {
    // The next reconcile tries again.
  }
}

async function setAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android' || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(TOUR_REMINDER_CHANNEL_ID, {
      name: t.tourReminders.channel,
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
      lightColor: '#f6c45c',
    });
  } catch {
    // Scheduling below still tries; the default channel takes over.
  }
}

async function reconcileInternal(): Promise<void> {
  if (!Notifications) return;
  await waitForSettingsHydration();
  let granted = false;
  if (useSettingsStore.getState().tourRemindersEnabled) {
    try {
      granted = (await Notifications.getPermissionsAsync()).status === 'granted';
    } catch {
      granted = false;
    }
  }
  await dismissOutdated();
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
    .filter((request) => request.identifier.startsWith(ID_PREFIX));
  const wanted = new Map((granted ? desiredReminders(Date.now()) : []).map((r) => [`${ID_PREFIX}${r.planId}`, r]));

  for (const request of scheduled) {
    const reminder = wanted.get(request.identifier);
    const same = reminder && request.content.data?.fireAtMs === reminder.fireAtMs &&
      request.content.title === reminder.title && request.content.body === reminder.body;
    if (same) {
      wanted.delete(request.identifier);
      continue;
    }
    await Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined);
  }
  if (wanted.size) await setAndroidChannel();
  for (const [identifier, reminder] of wanted) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: reminder.title,
          body: reminder.body,
          data: { kind: TOUR_REMINDER_KIND, planId: reminder.planId, fireAtMs: reminder.fireAtMs },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.fireAtMs,
          ...(Platform.OS === 'android' ? { channelId: TOUR_REMINDER_CHANNEL_ID } : {}),
        },
      });
    } catch {
      // One refused reminder must not stop the others; the next reconcile tries again.
    }
  }
}

let queue: Promise<void> = Promise.resolve();
let waiting: Promise<void> | null = null;

/** Make the scheduled tour reminders match the plans on this phone. Calls pile into one pass. */
export function reconcileTourReminders(): Promise<void> {
  if (waiting) return waiting;
  const next = queue.then(() => {
    waiting = null;
    return reconcileInternal();
  }).catch(() => undefined);
  waiting = next;
  queue = next;
  return next;
}

let subscribed = false;

/** App start and foreground: load the plans, then reconcile. Installs the store listeners once. */
export async function syncTourReminders(): Promise<void> {
  if (!subscribed) {
    subscribed = true;
    useToursStore.subscribe((state, previous) => {
      if (state.plans !== previous.plans || state.activeRun !== previous.activeRun ||
        state.runs !== previous.runs || state.hydrated !== previous.hydrated) {
        void reconcileTourReminders();
      }
    });
    useSettingsStore.subscribe((state, previous) => {
      if (state.tourRemindersEnabled !== previous.tourRemindersEnabled) void reconcileTourReminders();
    });
  }
  try {
    await useToursStore.getState().hydrate();
  } catch {
    // A failed load leaves the store unhydrated, which cancels every reminder below.
  }
  await reconcileTourReminders();
}

/** 'undetermined' means the phone never asked; only then may the tour detail offer to. */
export async function notificationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | null> {
  if (!Notifications) return null;
  try {
    return (await Notifications.getPermissionsAsync()).status as 'granted' | 'denied' | 'undetermined';
  } catch {
    return null;
  }
}

/** The one place a tour asks the OS for notifications; a yes schedules the reminders at once. */
export async function askTourReminderPermission(): Promise<boolean> {
  const result = await ensureNotificationPermissionForBeerFeatures();
  if (result.ok) await reconcileTourReminders();
  return result.ok;
}

export function isTourReminderResponse(
  response: ExpoNotifications.NotificationResponse | null,
): response is ExpoNotifications.NotificationResponse {
  return response?.notification.request.content.data?.kind === TOUR_REMINDER_KIND;
}

const handledTapIds = new Set<string>();
function claimTap(response: ExpoNotifications.NotificationResponse): boolean {
  const id = `${response.notification.request.identifier}:${response.notification.date}`;
  if (handledTapIds.has(id)) return false;
  if (handledTapIds.size >= 32) handledTapIds.clear();
  handledTapIds.add(id);
  return true;
}

/** The tapped plan, or null when it is gone from this phone. */
async function tappedPlan(response: ExpoNotifications.NotificationResponse): Promise<string | null> {
  const planId = response.notification.request.content.data?.planId;
  try {
    await useToursStore.getState().hydrate();
  } catch {
    return null;
  }
  return typeof planId === 'string' && useToursStore.getState().plans.some((plan) => plan.id === planId) ? planId : null;
}

export function subscribeTourReminderTap(
  onTap: (planId: string | null) => void,
): ExpoNotifications.Subscription {
  if (!Notifications) return { remove: () => undefined };
  try {
    return Notifications.addNotificationResponseReceivedListener((response) => {
      if (!isTourReminderResponse(response) || !claimTap(response)) return;
      void tappedPlan(response).then(onTap);
    });
  } catch {
    return { remove: () => undefined };
  }
}

export async function consumeInitialTourReminderTap(onTap: (planId: string | null) => void): Promise<void> {
  if (!Notifications) return;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!isTourReminderResponse(response)) return;
    if (claimTap(response)) onTap(await tappedPlan(response));
    await Notifications.clearLastNotificationResponseAsync();
  } catch {
    // A missing/old launch response must never block app startup.
  }
}
