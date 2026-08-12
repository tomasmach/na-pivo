import {
  DAY_KEYS,
  parseOsmOpeningHoursToWeeklyHours,
  type CommunityBeer,
  type WeeklyHours,
} from '@/data/communityHours';
import type { Pub } from '@/data/pubs';
import {
  isBeerListOverrideCurrent,
  type CommunityOverride,
} from '@/stores/communityStore';

const DAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'] as const;

export interface OpeningHoursRow {
  days: string;
  hours: string;
}

function formatIntervals(intervals: WeeklyHours[(typeof DAY_KEYS)[number]]): string {
  return intervals.map(([start, end]) => `${start}–${end}`).join(', ');
}

function groupLabel(from: number, to: number): string {
  return from === to ? DAY_LABELS[from] : `${DAY_LABELS[from]}–${DAY_LABELS[to]}`;
}

export function buildOpeningHoursRows(
  weeklyHours: WeeklyHours | null | undefined,
  rawHours: string | null | undefined,
  closedLabel: string,
): OpeningHoursRow[] {
  const hours = weeklyHours ?? parseOsmOpeningHoursToWeeklyHours(rawHours);
  if (!hours) return rawHours?.trim() ? [{ days: '', hours: rawHours.trim() }] : [];

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
