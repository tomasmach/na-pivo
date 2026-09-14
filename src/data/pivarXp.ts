/**
 * Pivař XP — client glue for the drink-logging ladder.
 *
 * XP is fully server-authoritative: POST /v1/drinks returns a compact `pivar`
 * snapshot ({xp, level, title, …, xp_awarded}) alongside the drink result.
 * The current product has one combined account level (drink XP + mapping XP),
 * so this module only publishes the authoritative drink component to the live
 * account profile. It deliberately does not announce a separate Pivař level.
 *
 * This data-layer module must not import accountStore: drinksClient is also
 * reachable from account-boundary cleanup, so importing the store here creates
 * a runtime require cycle while that store is still being initialized. The
 * store installs the single listener after its definition instead.
 */

export interface PivarSnapshot {
  xp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel?: number | null;
}

type PivarSnapshotListener = (snapshot: PivarSnapshot) => void;

let snapshotListener: PivarSnapshotListener | null = null;

/** Install the live account-store sink without making the data layer import it. */
export function setPivarSnapshotListener(listener: PivarSnapshotListener | null): void {
  snapshotListener = listener;
}

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

  snapshotListener?.({
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
