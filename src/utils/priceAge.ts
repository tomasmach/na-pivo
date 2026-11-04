

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

/** Whether an observation is valid for display, histograms and filtering. */
export function isPriceFresh(observedAt: string, nowMs: number = Date.now()): boolean {
  const days = priceAgeDays(observedAt, nowMs);
  return days !== null && days < PRICE_EXPIRES_AFTER_DAYS;
}
