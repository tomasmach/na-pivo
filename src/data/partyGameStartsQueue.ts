/** Durable, owner-scoped placement of a catalogue game onto one shared table. */

import { t } from '@/i18n';

import { ensureAccount } from './account';
import {
  isRetriablePartyGamesError,
  startPartyGame,
  type PartyGame,
  type PartyGameStartInput,
} from './partyGamesClient';
import { createCoalescingFlush } from './createQueue';
import {
  cancelUncommittedPartyGameAccountMerge,
  capturePartyGameBoundary,
  clearPartyGameAccountMergeIntentIfQueuesEmpty,
  combinePartyGameSignals,
  finalizePartyGameQueuesForAccountMerge,
  invalidatePartyGameBoundary,
  isPartyGameStartQueueItem,
  isPartyGameBoundaryCurrent,
  loadPartyGameStartsQueueState,
  newPartyGameStartsQueueState,
  preflightPartyGameQueuesForAccountMerge,
  promotePartyGameQueuesAccountMerge,
  recoverPartyGameQueuesForAccount,
  runPartyGameQueueMutation,
  savePartyGameStartsQueueState,
  type PartyGameBoundarySnapshot,
  type PartyGameStartQueueItem,
  type PartyGameStartsQueueState,
} from './partyGameQueueBoundary';
import {
  discardQueuedPartyGameEvents,
  localPartyGameId,
  remapQueuedPartyGameEvents,
} from './partyGamesQueue';

/** One evening exposes at most 64 catalogue games; never evict an accepted start. */
const MAX_QUEUE_LENGTH = 64;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type PartyGameStartDelivery =
  | { ok: true; game: PartyGame }
  | {
      ok: false;
      permanent: boolean;
      code: string;
      detail: string;
      discardedEvents: number;
    };

export interface PartyGameStartTicket {
  localGameId: string;
  input: PartyGameStartInput;
  ownerAccountId: string;
  delivery: Promise<PartyGameStartDelivery>;
}

function identity(item: PartyGameStartQueueItem): string {
  // Placement and lobby binding are two durable phases. An explicit empty
  // roster puts the cover on the table; the first non-empty/omitted roster
  // later activates that row. Keeping both phases lets an offline lobby bind
  // survive even while the placement request is still in flight.
  const phase = Array.isArray(item.input.rosterIds) && item.input.rosterIds.length === 0
    ? 'placement'
    : 'roster';
  return `${item.code.toUpperCase()}|${item.input.catalogKey}|${phase}`;
}

function stateForOwner(
  state: PartyGameStartsQueueState | null,
  ownerAccountId: string,
): PartyGameStartsQueueState | null {
  if (!state) return newPartyGameStartsQueueState(ownerAccountId);
  return state.ownerAccountId === ownerAccountId ? state : null;
}

function deliveryFailure(
  code: string,
  detail: string,
  permanent = false,
  discardedEvents = 0,
): PartyGameStartDelivery {
  return { ok: false, permanent, code, detail, discardedEvents };
}

async function remove(
  clientId: string,
  ownerAccountId: string,
  snapshot: PartyGameBoundarySnapshot,
): Promise<boolean> {
  return runPartyGameQueueMutation(async () => {
    if (!isPartyGameBoundaryCurrent(snapshot)) return false;
    const loaded = await loadPartyGameStartsQueueState();
    if (
      !loaded.ok ||
      !loaded.state ||
      loaded.state.ownerAccountId !== ownerAccountId ||
      !isPartyGameBoundaryCurrent(snapshot)
    ) return false;
    return savePartyGameStartsQueueState({
      ...loaded.state,
      items: loaded.state.items.filter((item) => item.input.clientId !== clientId),
    });
  });
}

async function deliver(
  item: PartyGameStartQueueItem,
  ownerAccountId: string,
  snapshot: PartyGameBoundarySnapshot,
  operationSignal?: AbortSignal,
): Promise<PartyGameStartDelivery> {
  const abort = combinePartyGameSignals(snapshot.signal, operationSignal);
  try {
    if (!isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) {
      return deliveryFailure('account', t.clientErrors.accountChanged);
    }
    // Bind the request before bearer acquisition. A clear/merge abort resolves
    // this wait and no old start can continue with a newly installed session.
    const session = await ensureAccount(abort.signal);
    if (
      !session ||
      session.accountId !== ownerAccountId ||
      !isPartyGameBoundaryCurrent(snapshot) ||
      abort.signal.aborted
    ) {
      return deliveryFailure('account', t.clientErrors.accountChanged);
    }

    const result = await startPartyGame(
      item.code,
      item.input,
      abort.signal,
      ownerAccountId,
    );
    if (!isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) {
      return deliveryFailure('account', t.clientErrors.accountChanged);
    }
    if (result.ok) {
      const remapped = await remapQueuedPartyGameEvents(
        item.code,
        localPartyGameId(item.input.clientId),
        result.game.id,
        ownerAccountId,
      );
      if (!remapped || !isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) {
        return deliveryFailure('storage', t.clientErrors.gameSaveFailed);
      }
      await remove(item.input.clientId, ownerAccountId, snapshot);
      return { ok: true, game: result.game };
    }

    if (!isRetriablePartyGamesError(result)) {
      const discarded = await discardQueuedPartyGameEvents(
        item.code,
        localPartyGameId(item.input.clientId),
        ownerAccountId,
        result.code,
      );
      // Remove the terminal start only after its local gameplay is accounted
      // for. A storage failure leaves both recoverable for a later retry.
      if (discarded.ok) await remove(item.input.clientId, ownerAccountId, snapshot);
      return deliveryFailure(
        result.code,
        result.detail || t.clientErrors.gameShareRejected,
        true,
        discarded.discarded,
      );
    }
    return deliveryFailure(result.code, result.detail);
  } finally {
    abort.cleanup();
  }
}

async function flushUnlocked(operationSignal: AbortSignal): Promise<void> {
  const snapshot = capturePartyGameBoundary();
  const abort = combinePartyGameSignals(snapshot.signal, operationSignal);
  try {
    const session = await ensureAccount(abort.signal);
    if (
      !session ||
      !isPartyGameBoundaryCurrent(snapshot) ||
      abort.signal.aborted
    ) return;
    if (!(await recoverPartyGameQueuesForAccount(session.accountId))) return;
    if (!isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) return;
    const loaded = await runPartyGameQueueMutation(loadPartyGameStartsQueueState);
    if (
      !loaded.ok ||
      !loaded.state ||
      loaded.state.ownerAccountId !== session.accountId ||
      !isPartyGameBoundaryCurrent(snapshot)
    ) return;

    const cutoff = Date.now() - MAX_AGE_MS;
    for (const item of loaded.state.items) {
      if (!isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) return;
      if (item.queuedAt < cutoff) {
        const discarded = await discardQueuedPartyGameEvents(
          item.code,
          localPartyGameId(item.input.clientId),
          loaded.state.ownerAccountId,
          'expired',
        );
        if (discarded.ok) {
          await remove(item.input.clientId, loaded.state.ownerAccountId, snapshot);
        }
        continue;
      }
      await deliver(item, loaded.state.ownerAccountId, snapshot, abort.signal);
    }
  } finally {
    abort.cleanup();
  }
}

const { flush: flushPartyGameStartsQueue, abortInFlight } =
  createCoalescingFlush(flushUnlocked, { protectPrivateAccount: false });

/** Persist the owner and correlation before the first network attempt. */
export async function enqueuePartyGameStart(
  code: string,
  input: PartyGameStartInput,
): Promise<PartyGameStartTicket | null> {
  const snapshot = capturePartyGameBoundary();
  const session = await ensureAccount(snapshot.signal);
  if (!session || !isPartyGameBoundaryCurrent(snapshot)) return null;
  const ownerAccountId = session.accountId;
  if (!(await recoverPartyGameQueuesForAccount(ownerAccountId))) return null;
  if (!isPartyGameBoundaryCurrent(snapshot)) return null;
  const candidate: PartyGameStartQueueItem = { code, input, queuedAt: Date.now() };
  if (!isPartyGameStartQueueItem(candidate)) return null;
  const item = await runPartyGameQueueMutation(async () => {
    if (!isPartyGameBoundaryCurrent(snapshot)) return null;
    const loaded = await loadPartyGameStartsQueueState();
    if (!loaded.ok || !isPartyGameBoundaryCurrent(snapshot)) return null;
    const state = stateForOwner(loaded.state, ownerAccountId);
    if (!state) return null;
    const existing = state.items.find((row) => identity(row) === identity(candidate));
    if (existing) return existing;
    if (state.items.length >= MAX_QUEUE_LENGTH) return null;
    const saved = await savePartyGameStartsQueueState({
      ...state,
      items: [...state.items, candidate],
    });
    return saved ? candidate : null;
  });
  if (!item || !isPartyGameBoundaryCurrent(snapshot)) return null;
  return {
    localGameId: localPartyGameId(item.input.clientId),
    input: item.input,
    ownerAccountId,
    delivery: deliver(item, ownerAccountId, snapshot),
  };
}

export interface PendingPartyGameRuntime {
  localGameId: string;
  rosterIds: string[];
}

/**
 * Restore a lobby that was durably accepted but could not reach the backend.
 * Placement-only rows deliberately do not qualify: they put a cover on the
 * table but do not prove which people the player selected in the lobby.
 */
export async function loadPendingPartyGameRuntime(
  code: string,
  catalogKey: string,
): Promise<PendingPartyGameRuntime | null> {
  const snapshot = capturePartyGameBoundary();
  const session = await ensureAccount(snapshot.signal);
  if (!session || !isPartyGameBoundaryCurrent(snapshot)) return null;
  if (!(await recoverPartyGameQueuesForAccount(session.accountId))) return null;
  if (!isPartyGameBoundaryCurrent(snapshot)) return null;
  return runPartyGameQueueMutation(async () => {
    if (!isPartyGameBoundaryCurrent(snapshot)) return null;
    const loaded = await loadPartyGameStartsQueueState();
    if (
      !loaded.ok ||
      !loaded.state ||
      loaded.state.ownerAccountId !== session.accountId ||
      !isPartyGameBoundaryCurrent(snapshot)
    ) return null;
    const item = [...loaded.state.items].reverse().find(
      (candidate) =>
        candidate.code.toUpperCase() === code.toUpperCase() &&
        candidate.input.catalogKey === catalogKey &&
        Array.isArray(candidate.input.rosterIds) &&
        candidate.input.rosterIds.length > 0,
    );
    return item
      ? {
          localGameId: localPartyGameId(item.input.clientId),
          rosterIds: item.input.rosterIds ?? [],
        }
      : null;
  });
}

export {
  cancelUncommittedPartyGameAccountMerge,
  finalizePartyGameQueuesForAccountMerge,
  flushPartyGameStartsQueue,
  preflightPartyGameQueuesForAccountMerge,
  promotePartyGameQueuesAccountMerge,
};

export function clearPartyGameStartsQueue(): Promise<void> {
  invalidatePartyGameBoundary();
  abortInFlight();
  return runPartyGameQueueMutation(async () => {
    await savePartyGameStartsQueueState(null);
  }).then(async () => {
    await clearPartyGameAccountMergeIntentIfQueuesEmpty();
  });
}
