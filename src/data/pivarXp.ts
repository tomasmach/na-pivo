/**
 * Pivař XP — client glue for the drink-logging ladder.
 *
 * XP is fully server-authoritative: POST /v1/drinks returns a compact `pivar`
 * snapshot ({xp, level, title, …, xp_awarded}) alongside the drink result.
 * This module remembers the last seen level and fires a one-line level-up toast
 * when a delivered drink bumps it. No optimistic math — the counter's undo
 * window already delays delivery by a few seconds, so the toast lands right
 * after the tap anyway.
 *
 * The stored level is device-local. On a fresh install mid-ladder the first
 * snapshot just seeds the level silently (no toast for history).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { useToastStore } from '@/stores/toastStore';
import { cs } from '@/i18n/cs';

const LEVEL_KEY = 'na-pivo-pivar-level';

/** The compact `pivar` envelope on the POST /v1/drinks response. */
export interface PivarWireSnapshot {
  xp?: number;
  level?: number;
  title?: string;
  xp_awarded?: number;
}

/** Serialize note calls so two drinks delivered back-to-back can't both read
 *  the stale stored level and double-toast the same level-up. */
let noteChain: Promise<void> = Promise.resolve();

/**
 * Record a fresh server snapshot; toast when the level increased since the
 * last seen one. Best-effort and never throws — a failed AsyncStorage read
 * just skips the toast.
 */
export function notePivarSnapshot(raw: unknown): Promise<void> {
  noteChain = noteChain.then(() => noteUnchained(raw)).catch(() => undefined);
  return noteChain;
}

async function noteUnchained(raw: unknown): Promise<void> {
  const snapshot = raw as PivarWireSnapshot | null | undefined;
  const level = snapshot?.level;
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 1) return;

  let storedLevel: number | null = null;
  try {
    const stored = await AsyncStorage.getItem(LEVEL_KEY);
    if (stored != null) {
      const parsed = Number.parseInt(stored, 10);
      if (Number.isFinite(parsed)) storedLevel = parsed;
    }
  } catch {
    return;
  }

  if (storedLevel !== null && level > storedLevel) {
    const title = typeof snapshot?.title === 'string' ? snapshot.title : '';
    if (title) useToastStore.getState().show(cs.pivar.levelUpToast(title));
  }

  if (storedLevel === null || level !== storedLevel) {
    try {
      await AsyncStorage.setItem(LEVEL_KEY, String(level));
    } catch {
      // Next delivery re-notes; worst case a repeated toast, never a crash.
    }
  }
}
