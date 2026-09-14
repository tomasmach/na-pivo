/**
 * Pure read-model helpers for "Moje piva" (the pivní stopa).
 *
 * All of these derive purely from a `TallySession` (the local source of truth
 * already produced by the counter) — no new persistence, no backend. Kept pure
 * and side-effect-free so the screen and tests can rely on them. Dates are
 * bucketed by the SAME 04:00 "drinking day" rule the counter uses, so a 01:30
 * beer is shown under the night it belongs to, not the calendar date.
 */

import {
  drinkingDayKey,
  sessionDrinkTypeCounts,
  type TallyDrink,
  type TallySession,
} from '@/stores/tallyStore';
import { t , beerCountLabel, shotCountLabel, softDrinkCountLabel, wineCountLabel } from '@/i18n';
import { normalizeDrinkType, type DrinkType } from '@/drinks/drinkTypes';

/** A grouped line in an evening's breakdown: one row per beer + volume. */
export interface BreakdownLine {
  /** Display name as first counted (original case preserved). */
  name: string;
  drinkType: DrinkType;
  volumeMl?: number;
  count: number;
  totalCzk: number;
}

/** One editable row in the evening detail. Unlike the compact breakdown, this
 * keeps the concrete drinks so a grouped rename can update every server row and
 * the remove action can still retract exactly one counted drink. */
export interface DrinkActionGroup extends BreakdownLine {
  key: string;
  pricedCount: number;
  servingType?: TallyDrink['servingType'];
  drinks: TallyDrink[];
}

/** Group repeated drinks for the editable list. Serving stays in the identity
 * so a bottled and a draft beer never collapse into a misleading single row. */
export function sessionDrinkActionGroups(session: TallySession | null): DrinkActionGroup[] {
  if (!session) return [];
  const groups = new Map<string, DrinkActionGroup>();
  for (const drink of session.drinks) {
    const drinkType = normalizeDrinkType(drink.drinkType);
    const servingType = drink.servingType ?? 'unknown';
    const key = [
      drinkType,
      drink.beerName.trim().toLowerCase(),
      drink.volumeMl ?? '',
      servingType,
    ].join('|');
    const priceCzk = typeof drink.priceCzk === 'number' ? drink.priceCzk : 0;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalCzk += priceCzk;
      if (typeof drink.priceCzk === 'number') existing.pricedCount += 1;
      existing.drinks.push(drink);
      continue;
    }

    const group: DrinkActionGroup = {
      key,
      name: drink.beerName,
      drinkType,
      count: 1,
      totalCzk: priceCzk,
      pricedCount: typeof drink.priceCzk === 'number' ? 1 : 0,
      drinks: [drink],
    };
    if (typeof drink.volumeMl === 'number') group.volumeMl = drink.volumeMl;
    if (drink.servingType && drink.servingType !== 'unknown') {
      group.servingType = drink.servingType;
    }
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

/**
 * Group an evening's drinks into one line per (beer name + volume), preserving
 * the first-seen display name and summing the price. Order = first appearance.
 */
export function sessionBreakdown(session: TallySession | null): BreakdownLine[] {
  if (!session) return [];
  const order: string[] = [];
  const lines = new Map<string, BreakdownLine>();
  for (const drink of session.drinks) {
    const drinkType = normalizeDrinkType(drink.drinkType);
    const key = `${drinkType}|${drink.beerName.trim().toLowerCase()}|${drink.volumeMl ?? ''}`;
    // A drink outside a pub may have no price — it just doesn't add to totals.
    const priceCzk = typeof drink.priceCzk === 'number' ? drink.priceCzk : 0;
    const existing = lines.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalCzk += priceCzk;
    } else {
      order.push(key);
      const line: BreakdownLine = {
        name: drink.beerName,
        drinkType,
        count: 1,
        totalCzk: priceCzk,
      };
      if (typeof drink.volumeMl === 'number') line.volumeMl = drink.volumeMl;
      lines.set(key, line);
    }
  }
  return order.map((key) => lines.get(key) as BreakdownLine);
}

/** Compact mixed-evening label with beer kept first and zero categories hidden. */
export function sessionDrinkSummary(session: TallySession | null): string {
  const counts = sessionDrinkTypeCounts(session);
  const parts = [
    counts.beer > 0 ? beerCountLabel(counts.beer) : null,
    counts.wine > 0 ? wineCountLabel(counts.wine) : null,
    counts.soft_drink > 0 ? softDrinkCountLabel(counts.soft_drink) : null,
    counts.shot > 0 ? shotCountLabel(counts.shot) : null,
  ].filter((part): part is string => part !== null);
  return parts.join(' · ');
}

/** How `startedAt` relates to `now` by drinking day. */
export type EveningDayRelation = 'today' | 'yesterday' | 'older';

/** Parse a `YYYY-MM-DD` drinking-day key into a local-noon Date (noon avoids
 *  any DST edge when we only care about whole-day deltas). */
function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map((p) => Number(p));
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Whole drinking-days between two instants (b − a), by the 04:00 cutoff. */
export function drinkingDaysBetween(a: Date, b: Date): number {
  const da = dayKeyToDate(drinkingDayKey(a));
  const db = dayKeyToDate(drinkingDayKey(b));
  return Math.round((db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000));
}

/** Classify an evening's date relative to now: today / yesterday / older. */
export function eveningDayRelation(startedAt: string, now: Date): EveningDayRelation {
  const delta = drinkingDaysBetween(new Date(startedAt), now);
  if (delta <= 0) return 'today';
  if (delta === 1) return 'yesterday';
  return 'older';
}

/** Numeric Czech date for an evening's drinking day: "12. 6." (same year) or
 *  "12. 6. 2025" (a previous year). Based on the drinking day, not raw clock. */
export function formatEveningDate(startedAt: string, now: Date): string {
  const key = drinkingDayKey(new Date(startedAt));
  const [y, m, d] = key.split('-').map((p) => Number(p));
  const nowYear = Number(drinkingDayKey(now).split('-')[0]);
  const base = `${d}. ${m}.`;
  return y === nowYear ? base : `${base} ${y}`;
}

/** Human date label for an evening: "Dnes" / "Včera" / "12. 6.". */
export function eveningDateLabel(startedAt: string, now: Date): string {
  const rel = eveningDayRelation(startedAt, now);
  if (rel === 'today') return t.myBeers.today;
  if (rel === 'yesterday') return t.myBeers.yesterday;
  return formatEveningDate(startedAt, now);
}
