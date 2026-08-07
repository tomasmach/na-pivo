/**
 * The real shared evening: one per phone, or none.
 *
 * The hub has been running on a mock. This is the store the real thing hangs
 * off — who is at the table, what the code is, and whether we are still in it.
 * It holds exactly what the server says and nothing derived, so there is one
 * answer to "am I in an evening" and every screen reads the same one.
 *
 * The full evening is deliberately NOT persisted. A tiny, account-scoped and
 * 24-hour-limited server-confirmed identity is: it lets a cold offline launch
 * keep tagging beers with the table code without caching its people, pub or
 * activity. A successful current-evening response remains authoritative.
 *
 * `error` is the last thing that went wrong, in Czech, ready to show. The store
 * never throws and never blocks: the client is best-effort, so a pub with no
 * signal leaves the evening exactly as it was.
 */

import { create } from 'zustand';

import { ensureAccount, generateUuidV4 } from '@/data/account';
import { registerPrivateAccountFreezeListener } from '@/data/privateAccountBoundary';
import {
  enqueuePartyEveningAction,
  hasQueuedPartyEveningAction,
} from '@/data/partyEveningActionsQueue';
import {
  clearPartyEveningIdentityForAccount,
  clearPartyEveningIdentityForCode,
  loadPartyEveningIdentity,
  partyEveningIdentityGeneration,
  savePartyEveningIdentity,
  type ConfirmedPartyEveningIdentity,
} from '@/data/partyEveningIdentityCache';
import {
  createPartyEvening,
  fetchCurrentPartyEvening,
  generateJoinCode,
  joinPartyEvening,
  type PartyError,
  type PartyEvening,
} from '@/data/partyClient';

export interface PartyEveningState {
  evening: PartyEvening | null;
  /** Minimal active-table proof restored before the launch network request. */
  confirmedIdentity: ConfirmedPartyEveningIdentity | null;
  /** Last evening this phone successfully closed, kept for its recap route. */
  lastEvening: PartyEvening | null;
  /** True while a call is in flight — the UI disables rather than double-taps. */
  busy: boolean;
  /** True once the launch check has answered, so the UI can tell "no" from "not yet". */
  loaded: boolean;
  error: string | null;
  /** Code reserved by an in-flight create, so queued first writes can use it. */
  pendingJoinCode: string | null;

  /** Hydrate only the account-scoped 24h identity; performs no Party API request. */
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
  start: (
    pubName: string,
    pubCity?: string,
    joinCode?: string,
  ) => Promise<PartyEvening | null>;
  join: (code: string) => Promise<PartyEvening | null>;
  leave: () => Promise<boolean>;
  end: () => Promise<boolean>;
  finishFromServer: (endedAt: string) => void;
  clearError: () => void;
}

let boundaryGeneration = 0;
let membershipGeneration = 0;
let startPromise: Promise<PartyEvening | null> | null = null;

function failed(set: (patch: Partial<PartyEveningState>) => void, error: PartyError): null {
  set({ busy: false, error: error.detail });
  return null;
}

function identityFromEvening(evening: PartyEvening): ConfirmedPartyEveningIdentity {
  return {
    id: evening.id,
    joinCode: evening.joinCode.toUpperCase(),
    isHost: evening.isHost,
    confirmedAt: Date.now(),
  };
}

export function selectPartyJoinCode(state: PartyEveningState): string | null {
  if (state.evening?.active) return state.evening.joinCode;
  return state.pendingJoinCode ?? state.confirmedIdentity?.joinCode ?? null;
}

/**
 * A code the backend has confirmed belongs to an active table.
 *
 * `selectPartyJoinCode` intentionally also exposes the code reserved by an
 * in-flight create so offline beer writes can be staged against it. Anything
 * user-visible or sent to a child Party endpoint must use this stricter
 * selector: a reserved code is not shareable until the table POST succeeds.
 */
export function selectConfirmedPartyJoinCode(
  state: PartyEveningState,
): string | null {
  if (state.evening?.active) return state.evening.joinCode;
  return state.confirmedIdentity?.joinCode ?? null;
}

async function settlePendingPartyAssociations(
  pendingJoinCode: string,
  confirmedJoinCode: string | null,
): Promise<void> {
  // Keep the evening store independent from photo/visit queue modules at load.
  // Await settlement so callers flushing staged writes cannot overtake the
  // reserved-code rewrite after a slow create response.
  await Promise.all([
    import('@/data/beerPhotosQueue')
      .then(({ resolveBeerPhotoPartyAssociation }) =>
        resolveBeerPhotoPartyAssociation(pendingJoinCode, confirmedJoinCode),
      )
      .catch(() => undefined),
    import('@/data/visitsQueue')
      .then(({ resolveQueuedVisitPartyAssociation }) =>
        resolveQueuedVisitPartyAssociation(pendingJoinCode, confirmedJoinCode),
      )
      .catch(() => undefined),
  ]);
}

export const usePartyEveningStore = create<PartyEveningState>()((set, get) => ({
  evening: null,
  confirmedIdentity: null,
  lastEvening: null,
  busy: false,
  loaded: false,
  error: null,
  pendingJoinCode: null,

  restore: async () => {
    const generation = boundaryGeneration;
    const membership = membershipGeneration;
    const session = await ensureAccount();
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;

    let restored = session
      ? await loadPartyEveningIdentity(session.accountId)
      : null;
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
    if (restored && await hasQueuedPartyEveningAction(restored.joinCode)) {
      await clearPartyEveningIdentityForAccount(session!.accountId);
      restored = null;
    }
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
    if (!get().evening && !get().pendingJoinCode) {
      set({ confirmedIdentity: restored });
      if (restored) {
        await settlePendingPartyAssociations(restored.joinCode, restored.joinCode);
      }
    }
  },

  refresh: async () => {
    const generation = boundaryGeneration;
    const membership = membershipGeneration;
    const cacheGeneration = partyEveningIdentityGeneration();

    // Hydrate BEFORE starting the request. A cold launch in a cellar can now
    // attach its first offline beer to the last server-confirmed table.
    await get().restore();
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
    const session = await ensureAccount();
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;

    const result = await fetchCurrentPartyEvening();
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
    if (!result.ok) {
      // A failed refresh is not "you are not in an evening". Keep what we have
      // and say nothing — walking into a cellar must not close the table.
      set({ loaded: true });
      return;
    }
    const locallyFinished = result.evening
      ? await hasQueuedPartyEveningAction(result.evening.joinCode)
      : false;
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
    if (locallyFinished) {
      // This phone already accepted an offline finish/leave. Keep that promise
      // even when a read succeeds before the queued write can be delivered.
      if (session) await clearPartyEveningIdentityForAccount(session.accountId);
      if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
      set({ evening: null, confirmedIdentity: null, loaded: true, error: null });
      return;
    }
    if (!result.evening) {
      if (session) await clearPartyEveningIdentityForAccount(session.accountId);
      if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
      set({ evening: null, confirmedIdentity: null, loaded: true, error: null });
      return;
    }
    const confirmedIdentity = session
      ? await savePartyEveningIdentity(
          session.accountId,
          result.evening,
          cacheGeneration,
        )
      : null;
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return;
    set({
      evening: result.evening,
      confirmedIdentity: confirmedIdentity ?? identityFromEvening(result.evening),
      loaded: true,
      error: null,
    });
    await settlePendingPartyAssociations(
      result.evening.joinCode,
      result.evening.joinCode,
    );
  },

  start: (pubName, pubCity, requestedJoinCode) => {
    if (startPromise) return startPromise;
    if (get().busy) return Promise.resolve(null);
    membershipGeneration += 1;
    const membership = membershipGeneration;
    const generation = boundaryGeneration;
    const cacheGeneration = partyEveningIdentityGeneration();
    const sessionPromise = ensureAccount();
    const joinCode = requestedJoinCode ?? generateJoinCode();
    set({ busy: true, error: null, lastEvening: null, pendingJoinCode: joinCode });
    const request = (async () => {
      const result = await createPartyEvening({
        // The id is the retry ticket: a second attempt after a lost response
        // returns the evening already created rather than starting another.
        clientId: generateUuidV4(),
        joinCode,
        pubName,
        pubCity,
      });
      const session = await sessionPromise;
      if (generation !== boundaryGeneration || membership !== membershipGeneration) return null;
      if (!result.ok) {
        failed(set, result);
        set({ pendingJoinCode: null });
        await settlePendingPartyAssociations(joinCode, null);
        return null;
      }
      if (!result.evening) {
        failed(set, {
          ok: false,
          code: 'protocol',
          detail: 'Server neposlal založený stůl. Zkus to znovu.',
        });
        set({ pendingJoinCode: null });
        await settlePendingPartyAssociations(joinCode, null);
        return null;
      }
      const evening = result.evening;
      const confirmedIdentity = session
        ? await savePartyEveningIdentity(
            session.accountId,
            evening,
            cacheGeneration,
          )
        : null;
      if (generation !== boundaryGeneration || membership !== membershipGeneration) return null;
      set({
        evening,
        confirmedIdentity: confirmedIdentity ?? identityFromEvening(evening),
        lastEvening: null,
        pendingJoinCode: null,
        busy: false,
        loaded: true,
      });
      await settlePendingPartyAssociations(joinCode, evening.joinCode);
      return evening;
    })();
    startPromise = request;
    void request.finally(() => {
      if (startPromise === request) startPromise = null;
    });
    return request;
  },

  join: async (code) => {
    if (get().busy) return null;
    membershipGeneration += 1;
    const membership = membershipGeneration;
    const generation = boundaryGeneration;
    const cacheGeneration = partyEveningIdentityGeneration();
    const sessionPromise = ensureAccount();
    set({ busy: true, error: null, lastEvening: null });
    const result = await joinPartyEvening(code);
    const session = await sessionPromise;
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return null;
    if (!result.ok) return failed(set, result);
    if (!result.evening) {
      return failed(set, {
        ok: false,
        code: 'protocol',
        detail: 'Server neposlal přisednutý stůl. Zkus to znovu.',
      });
    }
    const evening = result.evening;
    const confirmedIdentity = session
      ? await savePartyEveningIdentity(
          session.accountId,
          evening,
          cacheGeneration,
        )
      : null;
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return null;
    set({
      evening,
      confirmedIdentity: confirmedIdentity ?? identityFromEvening(evening),
      lastEvening: null,
      busy: false,
      loaded: true,
    });
    return evening;
  },

  leave: async () => {
    const evening = get().evening;
    const identity = get().confirmedIdentity;
    const joinCode = evening?.joinCode ?? identity?.joinCode;
    if (!joinCode || get().busy) return false;
    membershipGeneration += 1;
    const membership = membershipGeneration;
    const generation = boundaryGeneration;
    set({ busy: true, error: null });
    const result = await enqueuePartyEveningAction('leave', joinCode);
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return false;
    if (!result.accepted) {
      failed(set, result.error);
      return false;
    }
    // Leaving is not ending: the table plays on, this phone is just out of it.
    await clearPartyEveningIdentityForCode(joinCode);
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return false;
    set({
      evening: null,
      confirmedIdentity: null,
      lastEvening: evening
        ? { ...evening, active: false, endedAt: new Date().toISOString() }
        : get().lastEvening,
      busy: false,
    });
    return true;
  },

  end: async () => {
    const evening = get().evening;
    const identity = get().confirmedIdentity;
    const joinCode = evening?.joinCode ?? identity?.joinCode;
    if (!joinCode || get().busy) return false;
    membershipGeneration += 1;
    const membership = membershipGeneration;
    const generation = boundaryGeneration;
    set({ busy: true, error: null });
    const result = await enqueuePartyEveningAction('end', joinCode);
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return false;
    if (!result.accepted) {
      failed(set, result.error);
      return false;
    }
    await clearPartyEveningIdentityForCode(joinCode);
    if (generation !== boundaryGeneration || membership !== membershipGeneration) return false;
    set({
      evening: null,
      confirmedIdentity: null,
      lastEvening:
        result.evening ??
        (evening
          ? { ...evening, active: false, endedAt: new Date().toISOString() }
          : get().lastEvening),
      busy: false,
    });
    return true;
  },

  finishFromServer: (endedAt) => {
    const evening = get().evening;
    const identity = get().confirmedIdentity;
    const joinCode = evening?.joinCode ?? identity?.joinCode;
    if (!joinCode) return;
    membershipGeneration += 1;
    void clearPartyEveningIdentityForCode(joinCode);
    set({
      evening: null,
      confirmedIdentity: null,
      lastEvening: evening ? { ...evening, active: false, endedAt } : get().lastEvening,
      busy: false,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));

/** Synchronous account-boundary reset; stale requests may no longer repopulate it. */
export function clearPartyEveningState(): void {
  boundaryGeneration += 1;
  membershipGeneration += 1;
  startPromise = null;
  usePartyEveningStore.setState({
    evening: null,
    confirmedIdentity: null,
    lastEvening: null,
    busy: false,
    loaded: false,
    error: null,
    pendingJoinCode: null,
  });
}

registerPrivateAccountFreezeListener(() => {
  boundaryGeneration += 1;
  membershipGeneration += 1;
  startPromise = null;
  usePartyEveningStore.setState({ busy: false });
});
