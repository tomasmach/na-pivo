import { DAY_KEYS, type DayKey, type WeeklyHours } from '@/data/communityHours';
import { numberFormat } from '@/utils/intlFormat';

/** 260 → { "260", "m" }, 1240 → { "1,2", "km" } in the app's language. */
export function formatDistance(meters: number): { value: string; unit: string } {
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return { value: String(m), unit: 'm' };
  return { value: numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(m / 1000), unit: 'km' };
}

export function distanceLabel(meters: number): string {
  const d = formatDistance(meters);
  return `${d.value} ${d.unit}`;
}

/** "HH:MM" of an ISO instant in the phone's time, or null when it does not parse. */
export function clockOf(iso: string | null | undefined): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type HoursTone = 'open' | 'closed' | 'unknown';

/** Open or closed now and the next change, only from hours the server actually resolved. */
export function hoursNow(pub: {
  hoursStatus?: string;
  isOpenNow?: boolean | null;
  nextChange?: string | null;
}): { tone: HoursTone; until: string | null } {
  if (pub.hoursStatus !== 'ok' || typeof pub.isOpenNow !== 'boolean') return { tone: 'unknown', until: null };
  return { tone: pub.isOpenNow ? 'open' : 'closed', until: clockOf(pub.nextChange) };
}

export type WeekRow = { from: DayKey; to: DayKey; intervals: string[]; today: boolean };

/** Runs of neighbouring days with the same hours, so "Po–Čt 15:00–23:00" is one row instead of four. */
export function weekRows(week: WeeklyHours, today: DayKey): WeekRow[] {
  const rows: WeekRow[] = [];
  for (const day of DAY_KEYS) {
    const intervals = week[day].map(([start, end]) => `${start}–${end}`);
    const last = rows[rows.length - 1];
    if (last && last.intervals.join(',') === intervals.join(',')) {
      last.to = day;
      last.today ||= day === today;
    } else {
      rows.push({ from: day, to: day, intervals, today: day === today });
    }
  }
  return rows;
}
