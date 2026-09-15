/**
 * FotoPivař round countdown — turns the contest's `periodEnd` into the Czech
 * header line ("Končí za 3 dny" / "Poslední den! …" / "Kolo skončilo…").
 *
 * Day counting is CALENDAR-day based in local time (midnights between now and
 * the end), not 24h buckets: a round ending tomorrow at 09:00 must say "Končí
 * zítra" even when that is only 14 hours away. Once `periodEnd` has passed the
 * round is over regardless of the calendar day. Pure and side-effect free so it
 * can be unit-tested with a fixed `now`.
 */

import { t } from '@/i18n';

/** Local-midnight timestamp for calendar-day arithmetic. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The countdown label for the contest header, or '' when `periodEndIso` is
 * missing/unparseable (the UI then just hides the line). Never throws.
 */
export function contestCountdownLabel(periodEndIso: string, now: Date = new Date()): string {
  const endMs = Date.parse(periodEndIso);
  if (!Number.isFinite(endMs)) return '';
  if (endMs <= now.getTime()) return t.photoContest.ended;

  const dayDiff = Math.round((startOfDay(new Date(endMs)) - startOfDay(now)) / DAY_MS);
  if (dayDiff <= 0) return t.photoContest.endsToday;
  return t.photoContest.endsInDays(dayDiff);
}
