import type { Pub } from '@/data/pubs';
import { generateUuidV4 } from '@/data/account';
import { geohash8 } from '@/data/geohash';
export const TOUR_LIMIT = 100;
export type TourError = 'storage' | 'corrupt_storage' | 'account_changed' | 'busy' | 'limit' | 'invalid' | 'duplicate' | 'active_run' | 'not_found' | 'network' | 'conflict' | 'expired' | 'throttled' | 'auth';
export type TourResult = {
  ok: true;
  id?: string;
} | {
  ok: false;
  error: TourError;
};
export interface TourStop {
  id: string;
  pubId: string;
  cacheKey: string | null;
  name: string;
  address: string;
  lat: number;
  lon: number;
}
export interface TourPlan {
  id: string;
  title: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  timezone: string;
  stops: TourStop[];
  revision: number;
  updatedAt: string;
  source?: {
    tourId: string;
    revision: number;
    token: string;
  };
  share?: {
    url: string;
    expiresAt: string;
  };
  conflict?: TourPlan;
}
export interface TourRun {
  id: string;
  planId: string;
  snapshot: TourPlan;
  startedAt: string;
  endedAt: string | null;
  statuses: Record<string, 'visited' | 'skipped'>;
}
export const uuidValid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export const cloneTour = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function newTour(): TourPlan {
  return { id: generateUuidV4(), title: '', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops: [], revision: 0, updatedAt: new Date().toISOString() };
}
export function stopFromPub(pub: Pub): TourStop {
  return { id: generateUuidV4(), pubId: pub.id, cacheKey: geohash8(pub.lat, pub.lng), name: pub.name, address: pub.address ?? pub.city ?? '', lat: pub.lat, lon: pub.lng };
}
export function samePub(a: TourStop, b: TourStop): boolean {
  return a.pubId === b.pubId || (!!a.cacheKey && a.cacheKey === b.cacheKey && a.name.trim().toLocaleLowerCase() === b.name.trim().toLocaleLowerCase());
}
export function validStop(s: unknown): s is TourStop {
  if (!s || typeof s !== 'object')
    return false;
  const v = s as TourStop;
  return uuidValid(v.id) && typeof v.pubId === 'string' && !!v.pubId && v.pubId.length <= 256 &&
    (v.cacheKey === null || typeof v.cacheKey === 'string') && typeof v.name === 'string' && !!v.name.trim() && v.name.length <= 255 &&
    typeof v.address === 'string' && v.address.length <= 500 && Number.isFinite(v.lat) && Math.abs(v.lat) <= 90 && Number.isFinite(v.lon) && Math.abs(v.lon) <= 180;
}
export function validPlan(value: unknown, draft = false): value is TourPlan {
  if (!value || typeof value !== 'object')
    return false;
  const v = value as TourPlan;
  if (!uuidValid(v.id) || typeof v.title !== 'string' || v.title.length > 60 || (!draft && !v.title.trim()) ||
    !Array.isArray(v.stops) || v.stops.length > 8 || (!draft && v.stops.length < 2) || !v.stops.every(validStop) ||
    !Number.isInteger(v.revision) || v.revision < 0 || typeof v.updatedAt !== 'string' || !Number.isFinite(Date.parse(v.updatedAt)) ||
    typeof v.timezone !== 'string' || !(v.scheduledDate === null || (typeof v.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.scheduledDate))) ||
    !(v.scheduledTime === null || (typeof v.scheduledTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.scheduledTime))) ||
    (v.scheduledTime !== null && v.scheduledDate === null))
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: v.timezone }).format();
  }
  catch {
    return false;
  }
  if (v.scheduledDate) {
    const date = new Date(`${v.scheduledDate}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== v.scheduledDate)
      return false;
  }
  if (v.stops.some((stop, i) => v.stops.slice(0, i).some((other) => other.id === stop.id || samePub(stop, other))))
    return false;
  if (v.source && (!uuidValid(v.source.tourId) || !Number.isInteger(v.source.revision) || v.source.revision < 1 || typeof v.source.token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(v.source.token)))
    return false;
  if (v.share && (typeof v.share.url !== 'string' || !/^https:\/\/na-pivo\.cz\/t\/[A-Za-z0-9_-]+$/.test(v.share.url) || !Number.isFinite(Date.parse(v.share.expiresAt))))
    return false;
  return !v.conflict || (!v.conflict.conflict && validPlan(v.conflict));
}
export function validSchedule(plan: TourPlan, now = new Date()): boolean {
  if (!plan.scheduledDate)
    return true;
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: plan.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 90);
  if (plan.scheduledDate < today || plan.scheduledDate > limit.toISOString().slice(0, 10)) return false;
  if (!plan.scheduledTime) return true;
  // A wall-clock time skipped by daylight saving is not a real meeting time.
  const wall = `${plan.scheduledDate}T${plan.scheduledTime}:00`;
  const target = Date.parse(`${wall}Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: plan.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(({ type, value }) => [type, value]));
    const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
    if (local === wall) return true;
    candidate += target - Date.parse(`${local}Z`);
  }
  return false;
}
export function validRun(value: unknown): value is TourRun {
  if (!value || typeof value !== 'object')
    return false;
  const v = value as TourRun;
  return uuidValid(v.id) && uuidValid(v.planId) && validPlan(v.snapshot) && v.planId === v.snapshot.id &&
    typeof v.startedAt === 'string' && Number.isFinite(Date.parse(v.startedAt)) &&
    (v.endedAt === null || (typeof v.endedAt === 'string' && Number.isFinite(Date.parse(v.endedAt)))) &&
    !!v.statuses && typeof v.statuses === 'object' && !Array.isArray(v.statuses) &&
    Object.entries(v.statuses).every(([id, status]) => v.snapshot.stops.some((s) => s.id === id) && (status === 'visited' || status === 'skipped'));
}
/** Where a group is in a run: the next unmarked stop and the last visited stop before it. */
export function runPosition(run: Pick<TourRun, 'snapshot' | 'statuses'>): { next?: TourStop; nextIndex: number; here?: TourStop } {
  const stops = run.snapshot.stops;
  const nextIndex = stops.findIndex((stop) => !run.statuses[stop.id]);
  const next = nextIndex >= 0 ? stops[nextIndex] : undefined;
  // Skipped stops do not move the group; the last visited one before the next stop does.
  const here = stops.slice(0, next ? nextIndex : stops.length).reverse().find((stop) => run.statuses[stop.id] === 'visited');
  return { next, nextIndex, here };
}
