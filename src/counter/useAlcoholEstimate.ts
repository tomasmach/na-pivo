import { useMemo } from 'react';

import { estimateAlcohol, type AlcoholEstimate, type EstimateDrink } from '@/drinks/alcoholEstimate';
import { useNowTick } from '@/friends/useNowTick';
import { intlLocale, t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';

const RECENT_SESSION_MS = 48 * 60 * 60 * 1000;

/** Recomputed every minute: the level keeps falling while nothing is logged. */
export function useAlcoholEstimate(): AlcoholEstimate | null {
  const profile = useSettingsStore((s) => s.bodyProfile);
  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const nowMs = useNowTick();

  return useMemo(() => {
    if (!profile) return null;
    const drinks = new Map<string, EstimateDrink>();
    const sessions = current ? [current, ...history] : history;
    for (const session of sessions) {
      if (Date.parse(session.startedAt) < nowMs - RECENT_SESSION_MS) continue;
      for (const drink of session.drinks) drinks.set(drink.id, drink);
    }
    return estimateAlcohol([...drinks.values()], profile, nowMs);
  }, [profile, current, history, nowMs]);
}

/** Below this the middle guess reads as zero and the cautious end takes over. */
export const MORNING_THRESHOLD = 0.05;

export function formatPromile(value: number): string {
  return value.toLocaleString(intlLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function dayOffset(date: Date, nowMs: number): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(date) - day(new Date(nowMs))) / (24 * 60 * 60 * 1000));
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' });
}

/** "zítra kolem 13:00" — the day is always spelled out, midnight moves it. */
export function formatZeroAt(date: Date, nowMs: number): string {
  const time = formatClock(date);
  const offset = dayOffset(date, nowMs);
  if (offset <= 0) return t.alcohol.whenToday(time);
  if (offset === 1) return t.alcohol.whenTomorrow(time);
  return t.alcohol.whenDate(date.toLocaleDateString(intlLocale, { day: 'numeric', month: 'numeric' }), time);
}

/** "13:00" today, "zítra 13:00" otherwise — for the short morning line. */
export function formatZeroAtShort(date: Date, nowMs: number): string {
  const time = formatClock(date);
  return dayOffset(date, nowMs) <= 0 ? time : t.alcohol.shortTomorrow(time);
}
