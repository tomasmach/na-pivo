import { t } from '@/i18n';

import type { AccountMapper, AccountPivar, MapperLevel } from './auth';
import { levelForXp } from './mapperXp';

/** One public account ladder. The backend still returns the older Mapér and
 * Pivař counters additively for released clients; the current app combines both
 * authoritative totals so every useful contribution moves the same level. */
export const FALLBACK_ACCOUNT_LEVELS: readonly MapperLevel[] = [
  { level: 1, title: t.xp.account.rookie, xp: 0 },
  { level: 2, title: t.xp.account.taster, xp: 150 },
  { level: 3, title: t.xp.account.journeyman, xp: 500 },
  { level: 4, title: t.xp.account.barkeep, xp: 1500 },
  { level: 5, title: t.xp.account.brewmaster, xp: 4000 },
  { level: 6, title: t.xp.account.beerMaster, xp: 9000 },
  { level: 7, title: t.xp.account.beerLegend, xp: 18000 },
];

export interface AccountXpProgress {
  xp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel: number | null;
}

export function accountXpProgress(
  mapper: AccountMapper | undefined,
  pivar: AccountPivar | undefined,
): AccountXpProgress | null {
  if (!mapper && !pivar) return null;

  const xp = Math.max(0, mapper?.xp ?? 0) + Math.max(0, pivar?.xp ?? 0);
  const levels = pivar?.levels?.length ? pivar.levels : FALLBACK_ACCOUNT_LEVELS;
  const sorted = [...levels].sort((a, b) => a.xp - b.xp);
  const current = levelForXp(xp, sorted);
  const currentIndex = sorted.findIndex((rung) => rung.level === current.level);
  const next = currentIndex >= 0 ? sorted[currentIndex + 1] : undefined;

  return {
    xp,
    level: current.level,
    title: current.title,
    xpIntoLevel: Math.max(0, xp - current.xp),
    xpForNextLevel: next ? Math.max(0, next.xp - current.xp) : null,
  };
}
