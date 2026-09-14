import { intlLocale } from '@/i18n';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Return the earliest valid ISO timestamp, ignoring absent or malformed data. */
export function earliestTimestamp(values: (string | null | undefined)[]): string | null {
  let earliestMs: number | null = null;
  let earliestValue: string | null = null;

  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (earliestMs == null || parsed < earliestMs) {
      earliestMs = parsed;
      earliestValue = value;
    }
  }

  return earliestValue;
}

/** Lifetime beers per elapsed day, counting the first day as day one. */
export function dailyBeerAverage(
  totalBeers: number,
  firstBeerAt: string | null,
  now: Date = new Date(),
): number | null {
  if (totalBeers <= 0) return 0;
  if (!firstBeerAt) return null;

  const firstMs = Date.parse(firstBeerAt);
  const nowMs = now.getTime();
  if (!Number.isFinite(firstMs) || !Number.isFinite(nowMs)) return null;

  const elapsedDays = Math.floor(Math.max(0, nowMs - firstMs) / DAY_MS) + 1;
  return totalBeers / elapsedDays;
}

export function formatDailyBeerAverage(value: number | null): string {
  if (value == null) return '-';
  return value
    .toLocaleString(intlLocale, { minimumFractionDigits: 0, maximumFractionDigits: 1 })
    .replace(/ /g, ' ');
}
