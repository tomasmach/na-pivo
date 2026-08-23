/**
 * Pure invite-confirmation navigation coordinator (Parta 3.0 §A5).
 *
 * Three sources can open the `/parta/pozvanka` confirmation and they race:
 *   - a warm explicit link tap (`handleExplicitInviteCode`),
 *   - the delayed cold-start `getInitialURL` result, which is an explicit
 *     event too (`beginExplicitLookup` before awaiting, then resolve),
 *   - a persisted code restored after account initialization
 *     (`beginRestoreLookup` / `resolveRestoreLookup`).
 *
 * Each factory call keeps an explicit-generation clock that advances ONLY on
 * applied explicit events (warm taps and resolved initial URLs). A lookup
 * ticket predating a newer explicit event has been beaten and stays silent —
 * a persisted restore never advances this clock, so an in-flight initial URL
 * keeps its explicit priority even when the restore lands first. Restores
 * additionally never replace an owned confirmation. The result is a decision —
 * none/push/replace plus the winning code — so callers translate it into
 * router calls; this module never touches React, Linking or storage.
 */

export type InviteNavigationAction = 'none' | 'push' | 'replace';

export interface InviteNavigationDecision {
  action: InviteNavigationAction;
  code: string | null;
}

type ConfirmationOwner = 'none' | 'restore' | 'explicit';

function normalizeInviteCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const NONE: InviteNavigationDecision = { action: 'none', code: null };

export function createInviteNavigationCoordinator() {
  // Explicit-generation clock: advances only on applied explicit events.
  let eventSequence = 0;
  let owner: ConfirmationOwner = 'none';
  let currentCode: string | null = null;

  const applyExplicitCode = (rawCode: unknown): InviteNavigationDecision => {
    const code = normalizeInviteCode(rawCode);
    if (!code) return NONE;
    eventSequence += 1;
    if (currentCode === code) {
      // Same screen is already up: repeating the same explicit code is a
      // no-op — but ownership promotes to explicit so a later persisted
      // restore cannot take over.
      owner = 'explicit';
      return NONE;
    }
    const decision: InviteNavigationDecision = {
      action: owner === 'none' ? 'push' : 'replace',
      code,
    };
    owner = 'explicit';
    currentCode = code;
    return decision;
  };

  return {
    /** Reserve the current sequence for a delayed explicit URL before awaiting it. */
    beginExplicitLookup(): number {
      return eventSequence;
    },
    /** Apply a delayed explicit URL result; loses to any newer explicit event. */
    resolveExplicitLookup(ticket: number, rawCode: unknown): InviteNavigationDecision {
      const code = normalizeInviteCode(rawCode);
      if (!code || ticket < eventSequence) return NONE;
      return applyExplicitCode(code);
    },
    /** Reserve the current sequence for a persisted-code restore before awaiting it. */
    beginRestoreLookup(): number {
      return eventSequence;
    },
    /**
     * Apply a persisted-restore result: pushes only when no explicit/current
     * owner holds the confirmation and no newer explicit event landed. Never
     * advances the explicit-generation clock, so a delayed initial URL keeps
     * its priority even when this restore resolves first.
     */
    resolveRestoreLookup(ticket: number, rawCode: unknown): InviteNavigationDecision {
      const code = normalizeInviteCode(rawCode);
      if (!code || ticket < eventSequence) return NONE;
      if (owner !== 'none') return NONE;
      owner = 'restore';
      currentCode = code;
      return { action: 'push', code };
    },
    /** Apply a warm explicit invite event right away. */
    handleExplicitInviteCode(rawCode: unknown): InviteNavigationDecision {
      return applyExplicitCode(rawCode);
    },
    /** The confirmation screen closed; a later invite may push again. */
    leaveConfirmation(): void {
      owner = 'none';
      currentCode = null;
    },
  };
}

export type InviteNavigationCoordinator = ReturnType<typeof createInviteNavigationCoordinator>;
