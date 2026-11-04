import { normalizeDrinkType } from '@/drinks/drinkTypes';
import { formatVolume, intlLocale, t } from '@/i18n';
import type { TallyDrink } from '@/stores/tallyStore';

import { dateOfDay } from './eveningData';

/** "1 h 25 min", "4 h", "5 min": the one way the new look writes a duration. */
export function durationLabel(minutes: number): string {
  return t.nv.common.duration(Math.floor(minutes / 60), minutes % 60);
}

/** "čepované · 0,5 l", "lahváč · 0,5 l" or just the volume of a non-beer. */
export function servingLine(drink: Pick<TallyDrink, 'drinkType' | 'servingType' | 'volumeMl'>, inPub: boolean): string {
  const serving = drink.servingType;
  const kind =
    normalizeDrinkType(drink.drinkType) !== 'beer'
      ? null
      : serving && serving !== 'unknown' && serving !== 'draft'
        ? t.counter.servingTypeLabel(serving).toLowerCase()
        : inPub || serving === 'draft'
          ? t.nv.stamgast.draft
          : null;
  return [kind, drink.volumeMl ? formatVolume(drink.volumeMl) : null].filter(Boolean).join(' · ');
}

/** "Pá 23. 10." for a drinking day. */
export function nightDayLabel(day: string): string {
  const d = dateOfDay(day);
  return t.nv.stamgast.dayLabel(t.nv.stamgast.weekdaysFromSunday[d.getDay()], d.getDate(), d.getMonth() + 1);
}

export function distanceLabel(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toLocaleString(intlLocale, { maximumFractionDigits: 1 })} km`;
}
