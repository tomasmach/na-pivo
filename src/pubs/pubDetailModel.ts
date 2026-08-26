import {
  DAY_KEYS,
  parseOsmOpeningHoursToWeeklyHours,
  type CommunityBeer,
  type WeeklyHours,
} from '@/data/communityHours';
import type { Pub } from '@/data/pubs';
import { intlLocale } from '@/i18n';
import {
  isBeerListOverrideCurrent,
  type CommunityOverride,
} from '@/stores/communityStore';

/** Short weekday names from Intl. Czech writes them lower case, the table wants
 *  a capital, and English already arrives capitalised. 1. 1. 2024 was a Monday. */
const DAY_LABELS = Array.from({ length: 7 }, (_, index) => {
  const label = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' })
    .format(new Date(2024, 0, 1 + index, 12))
    .replace('.', '');
  return label.charAt(0).toLocaleUpperCase(intlLocale) + label.slice(1);
});

export interface OpeningHoursRow {
  days: string;
  hours: string;
}

function formatIntervals(intervals: WeeklyHours[(typeof DAY_KEYS)[number]]): string {
  return intervals.map(([start, end]) => `${start}-${end}`).join(', ');
}

function groupLabel(from: number, to: number): string {
  return from === to ? DAY_LABELS[from] : `${DAY_LABELS[from]}-${DAY_LABELS[to]}`;
}

export function buildOpeningHoursRows(
  weeklyHours: WeeklyHours | null | undefined,
  rawHours: string | null | undefined,
  closedLabel: string,
): OpeningHoursRow[] {
  const hours = weeklyHours ?? parseOsmOpeningHoursToWeeklyHours(rawHours);
  if (!hours) {
    const raw = rawHours?.trim().replace(/[\u2013\u2014]/g, '-');
    return raw ? [{ days: '', hours: raw }] : [];
  }

  const values = DAY_KEYS.map((day) => formatIntervals(hours[day]));
  const rows: OpeningHoursRow[] = [];
  let start = 0;
  for (let index = 1; index <= values.length; index += 1) {
    if (index < values.length && values[index] === values[start]) continue;
    rows.push({
      days: groupLabel(start, index - 1),
      hours: values[start] || closedLabel,
    });
    start = index;
  }
  return rows;
}

export function resolveDetailBeers(
  pub: Pick<Pub, 'beers' | 'beersUpdatedAt'>,
  override: CommunityOverride | undefined,
): CommunityBeer[] {
  if (isBeerListOverrideCurrent(override, pub.beersUpdatedAt) && override?.beers) {
    return override.beers;
  }
  return pub.beers ?? [];
}
