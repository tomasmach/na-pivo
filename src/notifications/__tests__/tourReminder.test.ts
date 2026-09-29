interface MockRequest {
  identifier: string;
  content: { title: string; body: string; data: Record<string, unknown> };
  trigger: { type: string; date: number };
}

const mockScheduled = new Map<string, MockRequest>();
const mockGetPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
const mockScheduleNotificationAsync = jest.fn(async (request: MockRequest) => {
  mockScheduled.set(request.identifier, request);
  return request.identifier;
});
const mockCancelScheduledNotificationAsync = jest.fn(async (identifier: string) => {
  mockScheduled.delete(identifier);
});
const mockGetLastNotificationResponseAsync = jest.fn();
const mockPresented: string[] = [];
const mockPresentedAt = new Map<string, number>();
const mockScheduledContent = new Map<string, { title: string; body: string }>();
const mockDismissNotificationAsync = jest.fn(async (identifier: string) => {
  mockPresented.splice(mockPresented.indexOf(identifier), 1);
});

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock') }));
jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'owner-a', authenticated: false })), getOrCreateDeviceId: jest.fn(async () => 'device-a'),
  generateUuidV4: jest.fn(() => jest.requireActual('node:crypto').randomUUID()),
}));
jest.mock('@/data/accountMerge', () => ({ readAccountMerge: jest.fn(async () => ({ ok: true, intent: null })) }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: mockGetPermissionsAsync,
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getAllScheduledNotificationsAsync: jest.fn(async () => [...mockScheduled.values()]),
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  cancelScheduledNotificationAsync: mockCancelScheduledNotificationAsync,
  getLastNotificationResponseAsync: mockGetLastNotificationResponseAsync,
  getPresentedNotificationsAsync: jest.fn(async () => mockPresented.map((identifier) => ({ request: { identifier, content: { ...mockScheduledContent.get(identifier), data: { fireAtMs: mockPresentedAt.get(identifier) } } } }))),
  dismissNotificationAsync: mockDismissNotificationAsync,
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import {
  consumeInitialTourReminderTap,
  reconcileTourReminders,
  syncTourReminders,
  TOUR_REMINDER_KIND,
  tourReminderAskText,
  tourReminderAt,
  tourReminderFor,
} from '../tourReminder';
import { clearToursPrivateData, useToursStore as store } from '@/stores/toursStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { newTour, type TourPlan } from '@/tours/model';

// Monday 28 September 2026, 10:00 in Prague (CEST, UTC+2).
const NOW = Date.parse('2026-09-28T08:00:00Z');
const plan = (patch: Partial<TourPlan>): TourPlan => ({
  ...newTour(), title: 'Žižkov', scheduledDate: '2026-10-02', scheduledTime: '19:00',
  stops: [{ id: jest.requireActual('node:crypto').randomUUID(), pubId: '1', cacheKey: null, name: 'U Vystřelenýho oka', address: '', lat: 50, lon: 14 }],
  ...patch,
});
const noRuns = { activeRun: null, runs: [] };
const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());

beforeAll(() => {
  // Only the clock is fake; promises and storage keep their real timers.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => jest.useRealTimers());

describe('when the reminder fires', () => {
  it('fires two hours before the meetup on the plan clock', () => {
    expect(iso(tourReminderAt(plan({})))).toBe('2026-10-02T15:00:00.000Z');
  });
  it('never fires before eight in the morning', () => {
    expect(iso(tourReminderAt(plan({ scheduledTime: '09:30' })))).toBe('2026-10-02T06:00:00.000Z');
  });
  it('keeps two hours for a meetup at eight or earlier', () => {
    expect(iso(tourReminderAt(plan({ scheduledTime: '07:00' })))).toBe('2026-10-02T03:00:00.000Z');
    // A meetup after midnight is reminded at midnight, not the evening before.
    expect(iso(tourReminderAt(plan({ scheduledTime: '01:00' })))).toBe('2026-10-01T22:00:00.000Z');
  });
  it('reminds a day without a time at noon', () => {
    expect(iso(tourReminderAt(plan({ scheduledTime: null })))).toBe('2026-10-02T10:00:00.000Z');
  });
  it('has nothing for a tour without a date', () => {
    expect(tourReminderAt(plan({ scheduledDate: null, scheduledTime: null }))).toBeNull();
  });
  it('follows the plan time zone, not the phone, across daylight saving', () => {
    expect(iso(tourReminderAt(plan({ timezone: 'America/New_York' })))).toBe('2026-10-02T21:00:00.000Z');
    // Prague is back on winter time after 25 October.
    expect(iso(tourReminderAt(plan({ scheduledDate: '2026-10-30' })))).toBe('2026-10-30T16:00:00.000Z');
  });
  it('skips a moment that already passed', () => {
    const today = plan({ scheduledDate: '2026-09-28', scheduledTime: '11:30' });
    expect(tourReminderFor(today, noRuns, NOW)).toBeNull();
    expect(tourReminderFor({ ...today, scheduledTime: '12:30' }, noRuns, NOW)?.fireAtMs).toBe(Date.parse('2026-09-28T08:30:00Z'));
  });
  it('skips a plan whose walk already started', () => {
    const p = plan({});
    const run = { id: p.id, planId: p.id, snapshot: p, startedAt: '2026-10-02T14:00:00Z', endedAt: null, statuses: {} };
    expect(tourReminderFor(p, { activeRun: run, runs: [] }, NOW)).toBeNull();
    expect(tourReminderFor(p, { activeRun: null, runs: [{ ...run, endedAt: '2026-10-02T14:30:00Z' }] }, NOW)).toBeNull();
    // A walk of the same plan on another day does not count.
    expect(tourReminderFor(p, { activeRun: null, runs: [{ ...run, startedAt: '2026-09-20T18:00:00Z', endedAt: '2026-09-20T22:00:00Z' }] }, NOW)).not.toBeNull();
  });
});

describe('copy', () => {
  it('names the tour, the time and the first pub', () => {
    expect(tourReminderFor(plan({}), noRuns, NOW)).toMatchObject({ title: 'Dneska Žižkov', body: 'Sraz v 19:00 · U Vystřelenýho oka' });
    expect(tourReminderFor(plan({ scheduledTime: '20:00' }), noRuns, NOW)?.body).toBe('Sraz ve 20:00 · U Vystřelenýho oka');
    expect(tourReminderFor(plan({ scheduledTime: null }), noRuns, NOW)?.body).toBe('Sraz dneska · U Vystřelenýho oka');
  });
  it('asks with the weekday and the reminder time', () => {
    const p = plan({});
    expect(tourReminderAskText(p, tourReminderAt(p)!, NOW)).toBe('Mám ti v pátek v 17:00 připomenout sraz?');
    const noon = plan({ scheduledDate: '2026-09-28', scheduledTime: null });
    expect(tourReminderAskText(noon, tourReminderAt(noon)!, NOW)).toBe('Mám ti dneska ve 12:00 připomenout sraz?');
    const later = plan({ scheduledDate: '2026-10-16' });
    expect(tourReminderAskText(later, tourReminderAt(later)!, NOW)).toBe('Mám ti v pátek 16. 10. v 17:00 připomenout sraz?');
  });
});

describe('scheduled reminders follow the plans', () => {
  const pub = (id: number) => ({ id: String(id), name: `Pub ${id}`, lat: 50 + id / 100, lng: 14 });
  async function savePlan(patch: { scheduledDate: string | null; scheduledTime: string | null }, id?: string) {
    await store.getState().beginDraft(id);
    await store.getState().updateDraft({ title: 'Žižkov', ...patch });
    if (!id) {
      await store.getState().addStop(pub(1));
      await store.getState().addStop(pub(2));
    }
    const result = await store.getState().saveDraft();
    if (!result.ok) throw new Error(result.error);
    await reconcileTourReminders();
    return result.id!;
  }
  const fireDates = () => [...mockScheduled.values()].map((r) => iso(r.trigger.date));

  beforeEach(async () => {
    jest.setSystemTime(NOW);
    jest.clearAllMocks();
    mockScheduled.clear();
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    useSettingsStore.setState({ tourRemindersEnabled: true });
    await clearToursPrivateData();
    await syncTourReminders();
  });

  it('schedules one reminder per dated plan and leaves it alone on the next pass', async () => {
    const id = await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    await savePlan({ scheduledDate: null, scheduledTime: null });
    expect([...mockScheduled.keys()]).toEqual([`tour-reminder-${id}`]);
    expect(mockScheduled.get(`tour-reminder-${id}`)).toMatchObject({
      content: { title: 'Dneska Žižkov', body: 'Sraz v 19:00 · Pub 1', data: { kind: TOUR_REMINDER_KIND, planId: id } },
      trigger: { type: 'date', date: Date.parse('2026-10-02T15:00:00Z') },
    });
    const calls = mockScheduleNotificationAsync.mock.calls.length;
    await syncTourReminders();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(calls);
  });

  it('keeps scheduled reminders when the tours cannot be read at start', async () => {
    const id = await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    const reminder = mockScheduled.get(`tour-reminder-${id}`)!;
    // A cold start: the store is not loaded yet and the phone still holds the reminder.
    store.setState({ hydrated: false });
    await reconcileTourReminders();
    mockScheduled.set(reminder.identifier, reminder);
    const hydrate = store.getState().hydrate;
    store.setState({ hydrate: async () => ({ ok: false, error: 'storage' }) });
    try {
      await syncTourReminders();
    } finally {
      store.setState({ hydrate });
    }
    expect([...mockScheduled.keys()]).toEqual([`tour-reminder-${id}`]);
  });

  it('moves the reminder with a new time and drops it with the date', async () => {
    const id = await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    await savePlan({ scheduledDate: '2026-10-03', scheduledTime: '15:00' }, id);
    expect(fireDates()).toEqual(['2026-10-03T11:00:00.000Z']);
    await savePlan({ scheduledDate: null, scheduledTime: null }, id);
    expect(mockScheduled.size).toBe(0);
  });

  it('cancels when the plan is deleted', async () => {
    const id = await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    await store.getState().deletePlan(id);
    await reconcileTourReminders();
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith(`tour-reminder-${id}`);
    expect(mockScheduled.size).toBe(0);
  });

  it('cancels once a walk of the plan starts', async () => {
    const id = await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    const started = await store.getState().startRun(id);
    expect(started.ok).toBe(true);
    await reconcileTourReminders();
    expect(mockScheduled.size).toBe(0);
  });

  it('drops the previous account plans on sign-out or account switch', async () => {
    await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    for (const [id, request] of mockScheduled) { mockPresented.push(id); mockPresentedAt.set(id, request.trigger.date); }
    mockPresented.push('pub-reminder-1');
    await clearToursPrivateData();
    await reconcileTourReminders();
    expect(mockScheduled.size).toBe(0);
    // A reminder already on screen goes too; other notifications stay.
    expect(mockPresented).toEqual(['pub-reminder-1']);
    mockPresented.length = 0;
  });

  it('takes a shown "today" reminder away the next day', async () => {
    await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    const [key, request] = [...mockScheduled.entries()][0];
    mockPresented.push(key); mockPresentedAt.set(key, request.trigger.date);
    mockScheduledContent.set(key, { title: request.content.title, body: request.content.body });
    jest.setSystemTime(Date.parse('2026-10-03T08:00:00Z'));
    await reconcileTourReminders();
    expect(mockPresented).toEqual([]);
  });

  it('takes a shown reminder away once the meetup moves, and keeps it while it is still true', async () => {
    const id = await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    const [key, request] = [...mockScheduled.entries()][0];
    mockPresented.push(key); mockPresentedAt.set(key, request.trigger.date);
    mockScheduledContent.set(key, { title: request.content.title, body: request.content.body });
    // Delivered at 17:00 on the meetup day.
    jest.setSystemTime(request.trigger.date);
    await reconcileTourReminders();
    expect(mockPresented).toEqual([key]);
    await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '21:00' }, id);
    await reconcileTourReminders();
    expect(mockPresented).toEqual([]);
  });

  it('keeps only the nearest twenty reminders pending on iOS', async () => {
    for (let day = 1; day <= 25; day++) await savePlan({ scheduledDate: `2026-10-${String(day).padStart(2, '0')}`, scheduledTime: '19:00' });
    await reconcileTourReminders();
    expect(mockScheduled.size).toBe(20);
    expect(Math.max(...[...mockScheduled.values()].map((r) => r.trigger.date))).toBeLessThan(Date.parse('2026-10-21T00:00:00Z'));
  });

  it('cancels everything when switched off in settings and comes back when on', async () => {
    await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    useSettingsStore.getState().setTourRemindersEnabled(false);
    await reconcileTourReminders();
    expect(mockScheduled.size).toBe(0);
    useSettingsStore.getState().setTourRemindersEnabled(true);
    await reconcileTourReminders();
    expect(mockScheduled.size).toBe(1);
  });

  it('turns the toggle off when notifications were refused elsewhere', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    await reconcileTourReminders();
    expect(useSettingsStore.getState().tourRemindersEnabled).toBe(false);
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    useSettingsStore.getState().setTourRemindersEnabled(true);
  });

  it('keeps scheduled reminders when the permission check itself fails', async () => {
    await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    expect(mockScheduled.size).toBe(1);
    mockGetPermissionsAsync.mockRejectedValueOnce(new Error('busy'));
    await reconcileTourReminders();
    expect(mockScheduled.size).toBe(1);
  });

  it('schedules nothing without notification permission', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('opens the tapped plan, or the list once it is gone', async () => {
    const id = await savePlan({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
    const tap = (date: number) => ({ notification: { date, request: { identifier: `tour-reminder-${id}`, content: { data: { kind: TOUR_REMINDER_KIND, planId: id } } } } });
    const onTap = jest.fn();
    mockGetLastNotificationResponseAsync.mockResolvedValue(tap(1));
    await consumeInitialTourReminderTap(onTap);
    await consumeInitialTourReminderTap(onTap);
    expect(onTap.mock.calls).toEqual([[id]]);
    await store.getState().deletePlan(id);
    mockGetLastNotificationResponseAsync.mockResolvedValue(tap(2));
    await consumeInitialTourReminderTap(onTap);
    expect(onTap).toHaveBeenLastCalledWith(null);
  });
});
