/**
 * Pure read-model helpers for the Výčep feed (published nights).
 *
 * A "night" here is everything the user drank on one drinking day (04:00
 * cutoff, same rule as the counter), possibly across several pubs — the
 * counter archives a session per sitting, so the night summary re-groups
 * sessions by `drinkingDayKey`. All helpers are pure so the publish sheet,
 * the story card and tests can share them.
 */

import {
  drinkingDayKey,
  sessionDrinkTypeCounts,
  type TallySession,
} from '@/stores/tallyStore';
import { isContextPubKey } from '@/drinks/drinkTypes';

/** Snapshot of one night as it gets published (and drawn on the story card).
 *  Deliberately excludes prices, GPS and individual beer names. */
export interface NightSummary {
  /** Stable idempotency key for the publish upsert: one row per drinking day. */
  clientKey: string;
  /** `YYYY-MM-DD` drinking-day key. */
  drinkingDay: string;
  startedAt: string;
  endedAt: string;
  beerCount: number;
  wineCount: number;
  softDrinkCount: number;
  shotCount: number;
  /** Unique pub names in first-visit order; outside sittings are excluded. */
  pubNames: string[];
  city?: string;
  durationMinutes?: number;
}

/** Cap mirrored by the backend validator. */
export const MAX_PUB_NAMES = 5;

function latestDrinkAt(session: TallySession): string {
  let latest = session.startedAt;
  let latestMs = Date.parse(latest);
  for (const drink of session.drinks) {
    const atMs = Date.parse(drink.at);
    if (Number.isFinite(atMs) && (!Number.isFinite(latestMs) || atMs > latestMs)) {
      latest = drink.at;
      latestMs = atMs;
    }
  }
  return latest;
}

/** All sessions (current + history) that belong to one drinking day, oldest
 *  first. Empty sessions carry no drinks and are skipped. */
export function sessionsOfNight(
  current: TallySession | null,
  history: TallySession[],
  dayKey: string,
): TallySession[] {
  const all = [...(current ? [current] : []), ...history];
  return all
    .filter((s) => s.drinks.length > 0 && drinkingDayKey(new Date(s.startedAt)) === dayKey)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** Build the publishable snapshot of one night. Returns null for a night with
 *  no drinks at all (nothing to hang up). */
export function buildNightSummary(sessions: TallySession[]): NightSummary | null {
  if (sessions.length === 0) return null;

  let beer = 0;
  let wine = 0;
  let soft = 0;
  let shot = 0;
  const pubNames: string[] = [];
  let city: string | undefined;

  for (const session of sessions) {
    const counts = sessionDrinkTypeCounts(session);
    beer += counts.beer;
    wine += counts.wine;
    soft += counts.soft_drink;
    shot += counts.shot;
    if (!isContextPubKey(session.pubKey)) {
      const name = session.pubName.trim();
      if (name && !pubNames.includes(name) && pubNames.length < MAX_PUB_NAMES) {
        pubNames.push(name);
      }
      if (!city && session.pubCity) city = session.pubCity;
    }
  }
  if (beer + wine + soft + shot === 0) return null;

  const startedAt = sessions[0].startedAt;
  let endedAt = startedAt;
  for (const session of sessions) {
    const candidate = latestDrinkAt(session);
    if (Date.parse(candidate) > Date.parse(endedAt)) endedAt = candidate;
  }

  const dayKey = drinkingDayKey(new Date(startedAt));
  const spanMs = Date.parse(endedAt) - Date.parse(startedAt);
  const durationMinutes =
    Number.isFinite(spanMs) && spanMs > 0 ? Math.round(spanMs / 60000) : undefined;

  const summary: NightSummary = {
    clientKey: `night-${dayKey}`,
    drinkingDay: dayKey,
    startedAt,
    endedAt,
    beerCount: beer,
    wineCount: wine,
    softDrinkCount: soft,
    shotCount: shot,
    pubNames,
  };
  if (city) summary.city = city;
  if (durationMinutes !== undefined) summary.durationMinutes = durationMinutes;
  return summary;
}

/** Split a beer count into tally-mark groups of five ("čárky na tácku"):
 *  12 → [5, 5, 2]. Capped so a troll number cannot blow up the layout; the
 *  caller renders the `overflow` remainder as "+N". */
export function tallyGroups(count: number, maxMarks = 25): { groups: number[]; overflow: number } {
  const shown = Math.max(0, Math.min(count, maxMarks));
  const groups: number[] = [];
  for (let remaining = shown; remaining > 0; remaining -= 5) {
    groups.push(Math.min(5, remaining));
  }
  return { groups, overflow: Math.max(0, count - shown) };
}

/** Whole hours of a night for the story stat trio (rounded to nearest hour,
 *  minimum 1 once the night spans at least half an hour). */
export function nightHours(durationMinutes?: number): number {
  if (!durationMinutes || durationMinutes < 30) return 0;
  return Math.max(1, Math.round(durationMinutes / 60));
}
