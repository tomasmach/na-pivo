/**
 * Pure helpers behind the pub page: they turn the data the app already holds
 * (weekly hours, upcoming events, the amenity aggregate) into the rows the page
 * renders. No React, no network, so the wording and grouping are unit-tested.
 */

import { DAY_KEYS, type CommunityBeer, type DayKey, type WeeklyHours } from '@/data/communityHours';
import type { WireAmenityAggregate } from '@/data/pubAmenitiesClient';
import type { PubEvent } from '@/data/pubEventsClient';

/** Map JS Date.getDay() (0=Sun..6=Sat) onto the Monday-first day keys. */
const JS_DAY_TO_KEY: readonly DayKey[] = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];

export function dayKeyOf(date: Date): DayKey {
  return JS_DAY_TO_KEY[date.getDay()];
}

export interface HoursRow {
  /** First and last day of a run of days with identical hours. */
  from: DayKey;
  to: DayKey;
  /** Intervals as "15:00–23:00", empty when the pub is closed those days. */
  intervals: string[];
  /** The run contains today. */
  today: boolean;
}

/**
 * Collapse the week into runs of consecutive days with the same hours, so
 * "Po–Čt 15:00–23:00" reads as one row instead of four identical ones.
 */
export function groupWeeklyHours(weekly: WeeklyHours, today: DayKey): HoursRow[] {
  const rows: HoursRow[] = [];
  for (const day of DAY_KEYS) {
    const intervals = (weekly[day] ?? []).map(([start, end]) => `${start}–${end}`);
    const signature = intervals.join(',');
    const last = rows[rows.length - 1];
    if (last && last.intervals.join(',') === signature) {
      last.to = day;
      last.today = last.today || day === today;
    } else {
      rows.push({ from: day, to: day, intervals, today: day === today });
    }
  }
  return rows;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole calendar days between two instants in local time (0 = same day). */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

export type EventDay =
  | { kind: 'running' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'date'; day: DayKey; date: Date };

/** Which calendar day an event belongs to, relative to now. */
export function eventDay(event: PubEvent, now: Date): EventDay {
  const start = new Date(event.startsAt);
  if (start.getTime() <= now.getTime()) return { kind: 'running' };
  const days = calendarDaysBetween(now, start);
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'tomorrow' };
  return { kind: 'date', day: dayKeyOf(start), date: start };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function eventStartTime(event: PubEvent): string {
  const start = new Date(event.startsAt);
  return `${twoDigits(start.getHours())}:${twoDigits(start.getMinutes())}`;
}

/**
 * Events the page may show: not ended yet, soonest first. The server already
 * filters, but a page left open must not keep an event that has since ended.
 */
export function visibleEvents(events: readonly PubEvent[], now: Date): PubEvent[] {
  return events
    .filter((event) => Date.parse(event.endsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * Amenities the crowd confirmed as present, in the server's order. Disputed or
 * absent ones are left out: the page only states what people agree on.
 */
export function confirmedAmenityKeys(
  aggregates: readonly WireAmenityAggregate[] | undefined,
): string[] {
  if (!aggregates) return [];
  return aggregates.filter((a) => a.status === 'yes').map((a) => a.amenity_key);
}

/** "350 m" / "1,4 km" style distance, formatted by the caller's locale helpers. */
export function roundedDistance(meters: number): { unit: 'm' | 'km'; value: number } {
  if (meters < 1000) return { unit: 'm', value: Math.max(10, Math.round(meters / 10) * 10) };
  return { unit: 'km', value: Math.round(meters / 100) / 10 };
}

/**
 * The tap list to show: a current local edit wins only when it actually
 * carries a beer list. An edit that changed just the hours must not hide the
 * server's taps (same rule as the compass and the counter).
 */
export function currentTaps(
  override: { beers?: CommunityBeer[] } | undefined,
  overrideIsCurrent: boolean,
  serverBeers: CommunityBeer[] | undefined,
): CommunityBeer[] {
  if (overrideIsCurrent && override?.beers) return override.beers;
  return serverBeers ?? [];
}

/**
 * Czech and Slovak pubs keep Prague time. Returns "now" as a local Date that
 * shows Prague's wall clock, so a weekly schedule reads right on a phone set
 * to another time zone. Falls back to the device clock if Intl cannot help.
 */
export function pubWallClock(now: Date): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value);
    const wall = new Date(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
    );
    return Number.isFinite(wall.getTime()) ? wall : now;
  } catch {
    return now;
  }
}

/** A pub added in the app has an id made of its coordinates; it changes when the pin moves. */
const COORDINATE_ID = /^mapy:-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

function isStableId(id: string | null | undefined): boolean {
  return Boolean(id) && !COORDINATE_ID.test(id as string);
}

/** Whether a visit or evening record belongs to this pub, not a neighbour in the same cell. */
export function isSamePubRecord(
  record: { name?: string | null; externalId?: string | null },
  pub: { id: string; name: string },
): boolean {
  if (record.externalId && pub.id && record.externalId === pub.id) return true;
  // Two known ids that differ are two businesses, even under one name.
  if (isStableId(record.externalId) && isStableId(pub.id)) return false;
  const name = (value: string) => value.trim().toLocaleLowerCase('cs');
  return Boolean(record.name) && name(record.name as string) === name(pub.name);
}

/** Whether an event belongs to this pub. An older backend names no pub, so its events stay. */
export function isEventOfPub(event: PubEvent, pub: { id: string; name: string }): boolean {
  if (!event.pubName && !event.pubExternalId) return true;
  return isSamePubRecord({ name: event.pubName, externalId: event.pubExternalId }, pub);
}

/**
 * Whether another business shares this pub's map cell. The server counts
 * beers per cell, so such a count would belong to both pubs.
 */
export function sharesCell(
  pubs: readonly { id: string; name: string; lat: number; lng: number }[],
  pubKey: string,
  pub: { id: string; name: string },
  cellOf: (lat: number, lng: number) => string,
): boolean {
  return pubs.some(
    (other) =>
      cellOf(other.lat, other.lng) === pubKey &&
      !isSamePubRecord({ name: other.name, externalId: other.id }, pub),
  );
}

/**
 * The same event with its times moved to Prague wall-clock, for display only:
 * a phone in another time zone still shows 19:00 for a 19:00 quiz in Prague.
 * Filtering stays on the real instants.
 */
export function inPubTime(event: PubEvent): PubEvent {
  return {
    ...event,
    startsAt: pubWallClock(new Date(event.startsAt)).toISOString(),
    endsAt: pubWallClock(new Date(event.endsAt)).toISOString(),
  };
}

/** What the catalogue owns: identity and place. A hand-off may be older. */
const CATALOG_OWNED = ['id', 'name', 'lat', 'lng', 'address', 'city', 'userAddedClientId'] as const;

/**
 * Combine an opener's copy of a pub with the loaded catalog copy. The catalog
 * wins on identity and location (a tour stop can predate a rename or a moved
 * pin); the hand-off fills in what the catalog lacks, such as fresh hours.
 */
export function withCatalogDetails<T extends object>(handedOff: T, catalog: T | undefined): T {
  if (!catalog) return handedOff;
  const defined = Object.fromEntries(
    Object.entries(handedOff).filter(([, value]) => value !== undefined && value !== ''),
  );
  const owned = Object.fromEntries(
    Object.entries(catalog).filter(
      ([field, value]) =>
        (CATALOG_OWNED as readonly string[]).includes(field) && value !== undefined && value !== '',
    ),
  );
  return { ...catalog, ...defined, ...owned } as T;
}
