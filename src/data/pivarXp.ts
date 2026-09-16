/**
 * Pivař XP — client glue for the drink-logging ladder.
 *
 * XP is fully server-authoritative: POST /v1/drinks returns a compact `pivar`
 * snapshot ({xp, level, title, …, xp_awarded}) alongside the drink result.
 * The current product has one combined account level (drink XP + mapping XP),
 * so this module only patches the authoritative drink component into the live
 * account profile. It deliberately does not announce a separate Pivař level.
 */
import { useAccountStore } from '@/stores/accountStore';

/** The compact `pivar` envelope on the POST /v1/drinks response. */
export interface PivarWireSnapshot {
  xp?: number;
  level?: number;
  title?: string;
  xp_into_level?: number;
  xp_for_next_level?: number | null;
  xp_awarded?: number;
}

/** Apply a fresh authoritative drink-XP component to the live account profile. */
export function notePivarSnapshot(raw: unknown): void {
  const snapshot = raw as PivarWireSnapshot | null | undefined;
  const xp = snapshot?.xp;
  const level = snapshot?.level;
  const xpIntoLevel = snapshot?.xp_into_level;
  if (
    typeof xp !== 'number' || !Number.isFinite(xp) || xp < 0 ||
    typeof level !== 'number' || !Number.isFinite(level) || level < 1 ||
    typeof xpIntoLevel !== 'number' || !Number.isFinite(xpIntoLevel) || xpIntoLevel < 0
  ) return;

  useAccountStore.getState().applyPivarSnapshot({
    xp,
    level,
    title: typeof snapshot?.title === 'string' ? snapshot.title : '',
    xpIntoLevel,
    xpForNextLevel:
      snapshot?.xp_for_next_level === null || typeof snapshot?.xp_for_next_level === 'number'
        ? snapshot.xp_for_next_level
        : undefined,
  });
}
