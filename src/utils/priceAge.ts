import { cs } from '@/i18n/cs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Observations older than this read as approximate ("≈ 42 Kč"). */
export const PRICE_APPROX_AFTER_DAYS = 180;

/** The server contract omits observations at or beyond this age. The client
 * repeats the guard for offline snapshots that can cross the boundary. */
export const PRICE_EXPIRES_AFTER_DAYS = 365;

/** Whole days between an ISO timestamp and now; null when unparsable. */
export function priceAgeDays(observedAt: string, nowMs: number = Date.now()): number | null {
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return null;
  return Math.max(0, Math.floor((nowMs - observedMs) / DAY_MS));
}

/** Human age of a price observation ("dnes", "před 3 týdny", "před 8 měsíci"). */
export function priceAgeLabel(observedAt: string, nowMs: number = Date.now()): string | null {
  const days = priceAgeDays(observedAt, nowMs);
  if (days === null) return null;
  if (days === 0) return cs.compass.priceAgeToday;
  if (days === 1) return cs.compass.priceAgeYesterday;
  if (days < 7) return cs.compass.priceAgeDays(days);
  if (days < 31) return cs.compass.priceAgeWeeks(Math.floor(days / 7));
  return cs.compass.priceAgeMonths(Math.max(1, Math.floor(days / 30)));
}

/** True when the observation is old enough to render as approximate. */
export function isPriceApproximate(observedAt: string, nowMs: number = Date.now()): boolean {
  const days = priceAgeDays(observedAt, nowMs);
  return days !== null && days >= PRICE_APPROX_AFTER_DAYS;
}

/** Whether an observation is valid for display, histograms and filtering. */
export function isPriceFresh(observedAt: string, nowMs: number = Date.now()): boolean {
  const days = priceAgeDays(observedAt, nowMs);
  return days !== null && days < PRICE_EXPIRES_AFTER_DAYS;
}
