import type { HoursStatus } from '@/data/pubs';

export const CLOSING_REMINDER_LEAD_MS = 60 * 60 * 1000;
/** A pub that closes sooner than this leaves no time to move anywhere. */
const MIN_TIME_LEFT_MS = 15 * 60 * 1000;
/** "Still open a while": open at least this long after your pub closes. */
export const OPEN_LONGER_BY_MS = 30 * 60 * 1000;
/** A closing time this far ahead is not tonight's. */
const MAX_HORIZON_MS = 18 * 60 * 60 * 1000;
const MAX_ALTERNATIVES = 3;

export interface ClosingHours {
  status: HoursStatus;
  isOpenNow: boolean | null;
  nextChange: string | null;
}

export interface ClosingCandidate extends ClosingHours {
  key: string;
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
}

export type ClosingAlternative = Omit<ClosingCandidate, keyof ClosingHours>;

export interface ClosingPlan {
  closesAtMs: number;
  fireAtMs: number;
  alternatives: ClosingAlternative[];
}

/** When an open pub closes next, or null when the hours do not say. */
function closesAtMs(hours: ClosingHours): number | null {
  if (hours.status !== 'ok' || hours.isOpenNow !== true || !hours.nextChange) return null;
  const ms = Date.parse(hours.nextChange);
  return Number.isFinite(ms) ? ms : null;
}

/** An open pub with no next change is open around the clock. */
function openUntil(hours: ClosingHours, afterMs: number): boolean {
  if (hours.status !== 'ok' || hours.isOpenNow !== true) return false;
  if (!hours.nextChange) return true;
  const closes = closesAtMs(hours);
  return closes !== null && closes >= afterMs;
}

/**
 * The ping an hour before your pub closes, with the nearest pubs that are open
 * now and stay open at least half an hour longer. Null when there is nothing
 * useful to say.
 */
export function planClosingReminder(input: {
  nowMs: number;
  current: ClosingHours;
  candidates: ClosingCandidate[];
}): ClosingPlan | null {
  const { nowMs, current, candidates } = input;
  const closes = closesAtMs(current);
  if (closes === null || closes - nowMs < MIN_TIME_LEFT_MS || closes - nowMs > MAX_HORIZON_MS) return null;

  const alternatives = candidates
    .filter((candidate) => openUntil(candidate, closes + OPEN_LONGER_BY_MS))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_ALTERNATIVES)
    .map(({ key, name, lat, lng, distanceMeters }) => ({ key, name, lat, lng, distanceMeters }));
  if (alternatives.length === 0) return null;

  return { closesAtMs: closes, fireAtMs: Math.max(closes - CLOSING_REMINDER_LEAD_MS, nowMs), alternatives };
}
