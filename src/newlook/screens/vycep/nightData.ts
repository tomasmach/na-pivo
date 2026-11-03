import { useMemo } from 'react';

import { intlLocale } from '@/i18n';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { drinkingDayKey, sessionDrinkTypeCounts, useTallyStore, type TallySession } from '@/stores/tallyStore';
import { buildNightSummary, nightSummariesNewestFirst, sessionsOfNight, type NightSummary } from '@/vycep/nightModel';

import { durationLabel as formatDuration } from '../stamgast/stamgastFormat';

export type NightView = {
  summary: NightSummary;
  sessions: TallySession[];
  /** Beers per pub in visit order, for the receipt. */
  perPub: { pub: string; count: number }[];
};

function viewOf(sessions: TallySession[]): NightView | null {
  const summary = buildNightSummary(sessions);
  if (!summary) return null;
  const perPub: { pub: string; count: number }[] = [];
  for (const session of sessions) {
    if (isContextPubKey(session.pubKey)) continue;
    const name = session.pubName.trim();
    const beers = sessionDrinkTypeCounts(session).beer;
    if (!name || beers === 0) continue;
    const row = perPub.find((line) => line.pub === name);
    if (row) row.count += beers;
    else perPub.push({ pub: name, count: beers });
  }
  return { summary, sessions, perPub };
}

/** Tonight (current drinking day) if anything was logged, else the latest night. */
export function useTonightOrLast(): NightView | null {
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  return useMemo(() => {
    const today = viewOf(sessionsOfNight(current, history, drinkingDayKey(new Date())));
    if (today) return today;
    const last = nightSummariesNewestFirst(current, history)[0];
    return last ? viewOf(sessionsOfNight(current, history, last.drinkingDay)) : null;
  }, [current, history]);
}

export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })
    : '';
}

/** "So 24. 10." */
export function shortDay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const text = d.toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric', month: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function durationLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return '';
  return formatDuration(minutes);
}

/** "Lokál → U Pinkasů · 4 h 10 min" */
export function routeLine(pubNames: string[], minutes: number | null | undefined): string {
  return [pubNames.join(' → '), durationLabel(minutes)].filter(Boolean).join(' · ');
}

/** Whole days until `iso`, rounded up; 0 on the last day. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = Date.parse(iso) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}
