import { useMemo } from 'react';

import {
  ESTIMATE_WINDOW_MS,
  estimateAlcohol,
  type AlcoholEstimate,
  type EstimateDrink,
} from '@/drinks/alcoholEstimate';
import { useNowTick } from '@/friends/useNowTick';
import { intlLocale, t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';

// A session can start a day before its last drink.
const RECENT_SESSION_MS = ESTIMATE_WINDOW_MS + 24 * 60 * 60 * 1000;

/** Recomputed every minute: the level keeps falling while nothing is logged. */
export function useAlcoholEstimate(): { estimate: AlcoholEstimate | null; nowMs: number } {
  const profile = useSettingsStore((s) => s.bodyProfile);
  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const tickMs = useNowTick();

  return useMemo(() => {
    if (!profile) return { estimate: null, nowMs: tickMs };
    const drinks = new Map<string, EstimateDrink>();
    // A drink logged since the last tick must count straight away.
    let nowMs = tickMs;
    const sessions = current ? [current, ...history] : history;
    for (const session of sessions) {
      if (Date.parse(session.startedAt) < tickMs - RECENT_SESSION_MS) continue;
      for (const drink of session.drinks) {
        drinks.set(drink.id, drink);
        const atMs = Date.parse(drink.at);
        if (atMs > nowMs && atMs - tickMs < 2 * 60 * 1000) nowMs = atMs;
      }
    }
    return { estimate: estimateAlcohol([...drinks.values()], profile, nowMs), nowMs };
  }, [profile, current, history, tickMs]);
}

/** Once absorbed and below this, the middle guess reads as zero and the cautious end takes over. */
export function isMorning(estimate: AlcoholEstimate): boolean {
  return !estimate.absorbing && estimate.now < 0.05;
}

/** The cautious level rounded up, so a morning never reads 0,0 while it is not zero. */
export function cautiousCeil(value: number): number {
  return Math.ceil(value * 10) / 10;
}

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

/** "13:00" today, "zítra 13:00" tomorrow — for the short morning line. */
export function formatZeroAtShort(date: Date, nowMs: number): string {
  const time = formatClock(date);
  const offset = dayOffset(date, nowMs);
  if (offset <= 0) return t.alcohol.shortToday(time);
  if (offset === 1) return t.alcohol.shortTomorrow(time);
  return formatZeroAt(date, nowMs);
}
