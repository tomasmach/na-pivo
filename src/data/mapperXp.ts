/**
 * Mapér XP — the bundled fallback ladder + the local optimistic estimate used by
 * the instant toast (spec §5.1). XP is server-authoritative; this is ONLY the
 * transient feel-good estimate shown before the PUT response lands. The durable
 * number always comes from GET /v1/account/me. When the server returns the
 * authoritative `xp_awarded` on the PUT envelope the sheet uses THAT, not this
 * estimate.
 *
 * The level→title mapping is locked (spec §5.1); the cumulative thresholds are
 * env-tunable server-side, so when a live `mapper.levels` table is available the
 * sheet should prefer it for naming an optimistic level-up. These bundled values
 * are the offline / dormant fallback.
 */

import type { MapperLevel, MapperXpRules } from './auth';

/** The locked 5-level ladder (titles locked; thresholds are the env defaults). */
export const FALLBACK_LEVELS: readonly MapperLevel[] = [
  { level: 1, title: 'Nováček', xp: 0 },
  { level: 2, title: 'Všímálek', xp: 50 },
  { level: 3, title: 'Štamgast', xp: 150 },
  { level: 4, title: 'Znalec', xp: 400 },
  { level: 5, title: 'Hospodský mudrc', xp: 900 },
];

/** The env-default XP awards (spec §5.4 xp_rules). Used when no live block. */
export const FALLBACK_XP_RULES: MapperXpRules = {
  firstFact: 15,
  firstMapperBonus: 25,
  confirm: 5,
  pubCompleteBonus: 30,
};

/** Map a cumulative XP total to its level + title using a ladder (lower-bound). */
export function levelForXp(
  xp: number,
  levels: readonly MapperLevel[] = FALLBACK_LEVELS,
): MapperLevel {
  const sorted = [...levels].sort((a, b) => a.xp - b.xp);
  let current = sorted[0] ?? FALLBACK_LEVELS[0];
  for (const rung of sorted) {
    if (xp >= rung.xp) current = rung;
    else break;
  }
  return current;
}
