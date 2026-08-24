/**
 * Pure invite-confirmation navigation coordinator (Parta 3.0 §A5).
 *
 * Expo Router synchronously canonicalizes cold and warm invite URLs before the
 * route reaches RootLayout. This coordinator arbitrates that explicit route
 * against a persisted code restored after account initialization.
 *
 * A restore ticket predating a canonical explicit route loses when its async
 * storage read resolves. Restores also never replace an owned confirmation.
 * This module never touches React, Router or storage.
 */

export type InviteNavigationAction = 'none' | 'push' | 'replace';

export interface InviteNavigationDecision {
  action: InviteNavigationAction;
  code: string | null;
}

export interface ExplicitEntryReservation {
  isCurrent(): boolean;
  commit(): boolean;
  release(): void;
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
  // Monotonic invalidation clock for prepared warm events. Unlike the
  // reversible state above, a failed cold reservation never rewinds history.
  let explicitRevision = 0;
  let owner: ConfirmationOwner = 'none';
  let currentCode: string | null = null;
  // An explicit URL/push owns this launch even after its screen closes. A
  // persisted friend invite belongs to startup recovery and must not surface
  // later over the destination the user explicitly chose.
  let restoreSuppressed = false;

  const applyExplicitCode = (rawCode: unknown): InviteNavigationDecision => {
    const code = normalizeInviteCode(rawCode);
    if (!code) return NONE;
    eventSequence += 1;
    explicitRevision += 1;
    restoreSuppressed = true;
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

  const reserveExplicitEntry = (
    ticket: number,
    intentKey: unknown,
  ): ExplicitEntryReservation | null => {
    const key = normalizeInviteCode(intentKey);
    if (!key || ticket !== eventSequence) return null;
    const previous = {
      eventSequence,
      owner,
      currentCode,
      restoreSuppressed,
    };
    eventSequence += 1;
    explicitRevision += 1;
    const reservationSequence = eventSequence;
    restoreSuppressed = true;
    owner = 'explicit';
    currentCode = null;
    let settled = false;
    const isCurrent = () =>
      !settled &&
      eventSequence === reservationSequence &&
      owner === 'explicit' &&
      currentCode === null;
    return {
      isCurrent,
      commit(): boolean {
        if (!isCurrent()) {
          settled = true;
          return false;
        }
        settled = true;
        return true;
      },
      release(): void {
        if (isCurrent()) {
          eventSequence = previous.eventSequence;
          owner = previous.owner;
          currentCode = previous.currentCode;
          restoreSuppressed = previous.restoreSuppressed;
        }
        settled = true;
      },
    };
  };

  return {
    /** Reserve the current explicit sequence before awaiting a launch input. */
    beginExplicitLookup(): number {
      return eventSequence;
    },
    /**
     * Capture the current explicit generation without taking ownership yet.
     * Warm notification taps use this before their durable ledger write: a
     * newer URL/invite can invalidate the ticket while storage is pending,
     * while a failed write leaves the previous navigation owner untouched.
     */
    prepareExplicitEntry(intentKey: unknown): ExplicitEntryReservation | null {
      const key = normalizeInviteCode(intentKey);
      if (!key) return null;
      const revision = explicitRevision;
      let settled = false;
      const isCurrent = () => !settled && revision === explicitRevision;
      return {
        isCurrent,
        commit(): boolean {
          if (!isCurrent()) {
            settled = true;
            return false;
          }
          settled = true;
          return reserveExplicitEntry(eventSequence, key)?.commit() ?? false;
        },
        release(): void {
          settled = true;
        },
      };
    },
    /**
     * Claim a non-confirmation explicit destination only if no newer explicit
     * URL or push landed while this input was being read.
     */
    resolveExplicitEntry(ticket: number, intentKey: unknown): boolean {
      const reservation = reserveExplicitEntry(ticket, intentKey);
      return reservation?.commit() ?? false;
    },
    /**
     * Reserve an explicit destination across a short durable write. A newer
     * URL/push invalidates the reservation; a failed write can release it so
     * startup restore is not suppressed by an action that never happened.
     */
    reserveExplicitEntry(
      ticket: number,
      intentKey: unknown,
    ): ExplicitEntryReservation | null {
      return reserveExplicitEntry(ticket, intentKey);
    },
    /** Reserve the current sequence for a persisted-code restore before awaiting it. */
    beginRestoreLookup(): number {
      return eventSequence;
    },
    /**
     * Apply a persisted-restore result: pushes only when no explicit/current
     * owner holds the confirmation and no newer explicit event landed. Never
     * advances the explicit-generation clock.
     */
    resolveRestoreLookup(ticket: number, rawCode: unknown): InviteNavigationDecision {
      const code = normalizeInviteCode(rawCode);
      if (!code || restoreSuppressed || ticket < eventSequence) return NONE;
      if (owner !== 'none') return NONE;
      owner = 'restore';
      currentCode = code;
      return { action: 'push', code };
    },
    /** Record the canonical explicit invite route already chosen by Expo Router. */
    handleExplicitInviteCode(rawCode: unknown): InviteNavigationDecision {
      return applyExplicitCode(rawCode);
    },
    /** Block an older persisted friend restore for a non-friend explicit entry. */
    handleExplicitEntry(intentKey: unknown): void {
      const key = normalizeInviteCode(intentKey);
      if (!key) return;
      eventSequence += 1;
      explicitRevision += 1;
      restoreSuppressed = true;
      owner = 'explicit';
      currentCode = null;
    },
    /** The confirmation screen closed; a later invite may push again. */
    leaveConfirmation(): void {
      owner = 'none';
      currentCode = null;
    },
    reset(): void {
      eventSequence = 0;
      explicitRevision = 0;
      owner = 'none';
      currentCode = null;
      restoreSuppressed = false;
    },
  };
}

export type InviteNavigationCoordinator = ReturnType<typeof createInviteNavigationCoordinator>;

/**
 * Native intents and cold notification taps can arrive before RootLayout
 * mounts. One process-level owner lets those entry points synchronously beat a
 * persisted friend-code restore before any router navigation starts.
 */
const processInviteNavigationCoordinator = createInviteNavigationCoordinator();
// This ticket is created with the process coordinator itself, before native
// intents can record a newer cold URL. RootLayout consumes it only if the
// initial notification actually resolves to a supported destination.
const processInitialNotificationNavigationTicket =
  processInviteNavigationCoordinator.beginExplicitLookup();

export function getProcessInviteNavigationCoordinator(): InviteNavigationCoordinator {
  return processInviteNavigationCoordinator;
}

export function getProcessInitialNotificationNavigationTicket(): number {
  return processInitialNotificationNavigationTicket;
}

export function resetProcessInviteNavigationCoordinatorForTests(): void {
  processInviteNavigationCoordinator.reset();
}
