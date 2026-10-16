import { intlLocale, t } from '@/i18n';
import type { TourPlan } from './model';

/** How far ahead a meetup may be; the server refuses anything later. */
export const MAX_DAYS_AHEAD = 90;
/** A meetup today needs at least this much time to get there. */
const LEAD_MINUTES = 15;

function parts(tz: string, now: Date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
}

/** Today's date where the tour happens, as YYYY-MM-DD. */
export function todayIn(tz: string, now = new Date()): string {
  const p = parts(tz, now);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 is Monday. */
export function weekday(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function lastDay(tz: string, now = new Date()): string {
  return addDays(todayIn(tz, now), MAX_DAYS_AHEAD);
}

export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The first meetup time still worth offering on that day, in minutes; 0 on any later day, null when today is over. */
export function earliestMinutes(date: string, tz: string, now = new Date()): number | null {
  if (date !== todayIn(tz, now)) return 0;
  const p = parts(tz, now);
  const next = Math.ceil((Number(p.hour) * 60 + Number(p.minute) + LEAD_MINUTES) / 15) * 15;
  return next < 24 * 60 ? next : null;
}

export function isPastDate(plan: Pick<TourPlan, 'scheduledDate' | 'timezone'>, now = new Date()): boolean {
  return !!plan.scheduledDate && plan.scheduledDate < todayIn(plan.timezone, now);
}

function dayText(date: string, tz: string, now: Date, withWeekday = true): string {
  const today = todayIn(tz, now);
  if (date === today) return t.tours.whenToday;
  if (date === addDays(today, 1)) return t.tours.whenTomorrow;
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(intlLocale, {
    ...(withWeekday ? { weekday: 'short' } : {}), day: 'numeric', month: intlLocale.startsWith('cs') ? 'numeric' : 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC',
  });
}

/** The instant of a wall-clock time in a zone, so the zone name is the one in force at the meetup, also on a daylight saving night. */
function meetupInstant(date: string, time: string, tz: string): Date {
  const wall = Date.parse(`${date}T${time}:00Z`);
  let instant = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(tz, new Date(instant));
    instant += wall - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  }
  return new Date(instant);
}

/** "pá 2. 10. · 19:00"; the zone only shows when this phone lives in another one. */
export function whenLabel(plan: Pick<TourPlan, 'scheduledDate' | 'scheduledTime' | 'timezone'>, now = new Date(), deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  if (!plan.scheduledDate) return null;
  const day = dayText(plan.scheduledDate, plan.timezone, now);
  if (!plan.scheduledTime) return day;
  const zone = deviceZone !== plan.timezone
    ? new Intl.DateTimeFormat(intlLocale, { timeZone: plan.timezone, timeZoneName: 'short' }).formatToParts(meetupInstant(plan.scheduledDate, plan.scheduledTime, plan.timezone)).find((part) => part.type === 'timeZoneName')?.value
    : null;
  return `${day} · ${plan.scheduledTime}${zone ? ` ${zone}` : ''}`;
}

export function pastLabel(plan: Pick<TourPlan, 'scheduledDate' | 'timezone'>, now = new Date()): string {
  return t.tours.whenPast(plan.scheduledDate ? dayText(plan.scheduledDate, plan.timezone, now, false) : '');
}

/** What an untitled tour is called when saved: the meetup weekday, or a plain name without one. */
export function suggestedTitle(plan: Pick<TourPlan, 'scheduledDate'>): string {
  return t.tours.suggestedTitle(plan.scheduledDate ? weekday(plan.scheduledDate) : null);
}
