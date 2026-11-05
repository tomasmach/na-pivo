/**
 * Read model of the new-look Štamgast: the local tally grouped into nights
 * (one drinking day with the 04:00 cutoff, across every pub of that night).
 * Pure functions over TallySession, so the screens stay thin and testable.
 */

import { normalizeDrinkType } from '@/drinks/drinkTypes';
import { drinkingDayKey, type TallyDrink, type TallySession } from '@/stores/tallyStore';

export interface NightPub {
  name: string;
  pubKey: string;
  firstAt: string;
  lastAt: string;
  beers: number;
}

export interface Night {
  /** Drinking day `YYYY-MM-DD`; the route id of an evening. */
  day: string;
  sessions: TallySession[];
  /** Every drink of the night, oldest first. */
  drinks: TallyDrink[];
  beers: number;
  spentCzk: number;
  /** Some drink carries a price, so `spentCzk` means something. */
  priced: boolean;
  pubs: NightPub[];
  startMs: number;
  endMs: number;
}

export const isBeer = (drink: TallyDrink) => normalizeDrinkType(drink.drinkType) === 'beer';

const atMs = (drink: TallyDrink) => Date.parse(drink.at);

const isRejected = (drink: TallyDrink) => drink.syncStatus === 'rejected';

/** The newest night holding drinks the server refused, and how many it holds. */
export function nightToFix(nights: readonly Night[]): { night: Night; count: number } | null {
  const night = nights.find((n) => n.drinks.some(isRejected));
  return night ? { night, count: night.drinks.filter(isRejected).length } : null;
}

/** Place and time come from the evening, so the fix form cannot change a rejection there. */
const UNFIXABLE_REJECTED_FIELDS = new Set([
  'name', 'lat', 'lng', 'city', 'external_id', 'place_context', 'drank_at',
  'client_id', 'evening_client_id', 'party_code',
]);

/** Whether the fix form can repair a rejection of `field`. Unknown means yes. */
export function canFixRejectedField(field: string | undefined): boolean {
  return !field || !UNFIXABLE_REJECTED_FIELDS.has(field);
}

export function dayKeyOf(date: Date): string {
  return drinkingDayKey(date);
}

/** `YYYY-MM-DD` → local noon of that day, safe for weekday and month math. */
export function dateOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

export function nightsOf(sessions: readonly TallySession[]): Night[] {
  const byDay = new Map<string, TallySession[]>();
  for (const session of sessions) {
    if (session.drinks.length === 0) continue;
    const firstAt = Math.min(...session.drinks.map(atMs).filter(Number.isFinite), Date.parse(session.startedAt));
    const day = drinkingDayKey(new Date(Number.isFinite(firstAt) ? firstAt : Date.parse(session.startedAt)));
    byDay.set(day, [...(byDay.get(day) ?? []), session]);
  }
  const nights: Night[] = [];
  for (const [day, group] of byDay) {
    const ordered = [...group].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const drinks = ordered.flatMap((s) => s.drinks).sort((a, b) => atMs(a) - atMs(b));
    const pubs: NightPub[] = [];
    for (const session of ordered) {
      const sorted = [...session.drinks].sort((a, b) => atMs(a) - atMs(b));
      const last = pubs[pubs.length - 1];
      const beers = sorted.filter(isBeer).length;
      if (last && last.pubKey === session.pubKey) {
        last.lastAt = sorted[sorted.length - 1].at;
        last.beers += beers;
      } else {
        pubs.push({ name: session.pubName, pubKey: session.pubKey, firstAt: sorted[0].at, lastAt: sorted[sorted.length - 1].at, beers });
      }
    }
    nights.push({
      day,
      sessions: ordered,
      drinks,
      beers: drinks.filter(isBeer).length,
      spentCzk: drinks.reduce((sum, d) => sum + (typeof d.priceCzk === 'number' ? d.priceCzk : 0), 0),
      priced: drinks.some((d) => typeof d.priceCzk === 'number'),
      pubs,
      startMs: atMs(drinks[0]),
      endMs: atMs(drinks[drinks.length - 1]),
    });
  }
  return nights.sort((a, b) => b.day.localeCompare(a.day));
}

/** 1-based number of the night counted from the first one in the diary. */
export function nightOrdinal(nights: readonly Night[], day: string): number {
  return nights.filter((n) => n.day <= day).length;
}

export function previousNight(nights: readonly Night[], day: string): Night | null {
  return nights.find((n) => n.day < day) ?? null;
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase();

export function hasBeerBefore(sessions: readonly TallySession[], name: string, exceptId: string): boolean {
  const key = nameKey(name);
  return sessions.some((s) => s.drinks.some((d) => d.id !== exceptId && isBeer(d) && nameKey(d.beerName) === key));
}

export interface BeerTally {
  name: string;
  count: number;
  last: TallyDrink;
}

/** Beers by how often they were logged, most first; `filter` narrows the drinks. */
export function beerTally(
  sessions: readonly TallySession[],
  filter: (drink: TallyDrink, session: TallySession) => boolean = () => true,
): BeerTally[] {
  const out = new Map<string, BeerTally>();
  for (const session of sessions) {
    for (const drink of session.drinks) {
      if (!isBeer(drink) || !filter(drink, session)) continue;
      const key = nameKey(drink.beerName);
      const entry = out.get(key);
      if (!entry) out.set(key, { name: drink.beerName.trim(), count: 1, last: drink });
      else {
        entry.count += 1;
        if (atMs(drink) > atMs(entry.last)) entry.last = drink;
      }
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count || atMs(b.last) - atMs(a.last));
}

/** Drinks of one type logged most often, newest serving first. */
export function drinkTally(sessions: readonly TallySession[], drinkType: string): BeerTally[] {
  const out = new Map<string, BeerTally>();
  for (const session of sessions) {
    for (const drink of session.drinks) {
      if (normalizeDrinkType(drink.drinkType) !== drinkType) continue;
      const key = nameKey(drink.beerName);
      const entry = out.get(key);
      if (!entry) out.set(key, { name: drink.beerName.trim(), count: 1, last: drink });
      else {
        entry.count += 1;
        if (atMs(drink) > atMs(entry.last)) entry.last = drink;
      }
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

/** Beers per clock hour of the night, from the first hour to the last. */
export function hourlyTempo(night: Night): { hour: number; count: number }[] {
  const beers = night.drinks.filter(isBeer);
  if (!beers.length) return [];
  const start = new Date(night.startMs);
  start.setMinutes(0, 0, 0);
  const hours = Math.min(12, Math.floor((night.endMs - start.getTime()) / 3600000) + 1);
  return Array.from({ length: hours }, (_, i) => {
    const from = start.getTime() + i * 3600000;
    return {
      hour: new Date(from).getHours(),
      count: beers.filter((d) => atMs(d) >= from && atMs(d) < from + 3600000).length,
    };
  });
}

export function minutesBetween(fromMs: number, toMs: number): number {
  return Number.isFinite(fromMs) && Number.isFinite(toMs) ? Math.max(0, Math.round((toMs - fromMs) / 60000)) : 0;
}

/** Nights whose drinking day falls in [fromDay, toDay]. */
export function nightsBetween(nights: readonly Night[], fromDay: string, toDay: string): Night[] {
  return nights.filter((n) => n.day >= fromDay && n.day <= toDay);
}

export function sumBeers(nights: readonly Night[]): number {
  return nights.reduce((a, n) => a + n.beers, 0);
}

export function sumSpent(nights: readonly Night[]): number {
  return nights.reduce((a, n) => a + n.spentCzk, 0);
}

export function distinctPubs(nights: readonly Night[]): number {
  return new Set(nights.flatMap((n) => n.pubs.filter((p) => !p.pubKey.startsWith('ctx:')).map((p) => p.pubKey))).size;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function dayString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
