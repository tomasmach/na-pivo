/**
 * Durable, owner-scoped offline queue for shared-game events.
 *
 * Events are append-only and idempotent by clientId. A local game reference is
 * kept until the start queue receives the server UUID; aliases live in the same
 * owner-scoped JSON document so a process death cannot reopen the remap race.
 */

import { ensureAccount } from './account';
import {
  isRetriablePartyGamesError,
  sendPartyGameEvents,
  type PartyGameEventInput,
} from './partyGamesClient';
import { createCoalescingFlush } from './createQueue';
import {
  capturePartyGameBoundary,
  clearPartyGameAccountMergeIntentIfQueuesEmpty,
  combinePartyGameSignals,
  invalidatePartyGameBoundary,
  isPartyGameQueueItem,
  isPartyGameBoundaryCurrent,
  loadPartyGamesQueueState,
  newPartyGamesQueueState,
  recoverPartyGameQueuesForAccount,
  runPartyGameQueueMutation,
  savePartyGamesQueueState,
  type PartyGameBoundarySnapshot,
  type PartyGameQueueItem,
  type PartyGamesQueueState,
} from './partyGameQueueBoundary';

/** Same durable ceiling as one backend evening; reject overflow, never evict pending work. */
const MAX_QUEUE_LENGTH = 5_000;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const MAX_BATCH = 50;
const MAX_ALIASES = 64;
const MAX_REJECTED_STARTS = 64;
const LOCAL_GAME_PREFIX = 'local:';

export function localPartyGameId(clientId: string): string {
  return `${LOCAL_GAME_PREFIX}${clientId}`;
}

export function isLocalPartyGameId(gameId: string): boolean {
  return gameId.startsWith(LOCAL_GAME_PREFIX);
}

function resolvedGameId(state: PartyGamesQueueState, code: string, gameId: string): string {
  return state.aliases.find(
    (alias) => alias.code === code && alias.localGameId === gameId,
  )?.serverGameId ?? gameId;
}

function stateForOwner(
  state: PartyGamesQueueState | null,
  ownerAccountId: string,
): PartyGamesQueueState | null {
  if (!state) return newPartyGamesQueueState(ownerAccountId);
  return state.ownerAccountId === ownerAccountId ? state : null;
}

function batches(queue: PartyGameQueueItem[]): PartyGameQueueItem[][] {
  const byGame = new Map<string, PartyGameQueueItem[]>();
  for (const item of queue) {
    const key = `${item.code}|${item.gameId}`;
    const bucket = byGame.get(key);
    if (bucket) bucket.push(item);
    else byGame.set(key, [item]);
  }
  return [...byGame.values()].flatMap((items) => {
    const chunks: PartyGameQueueItem[][] = [];
    for (let index = 0; index < items.length; index += MAX_BATCH) {
      chunks.push(items.slice(index, index + MAX_BATCH));
    }
    return chunks;
  });
}

async function currentOwner(
  snapshot: PartyGameBoundarySnapshot,
  signal: AbortSignal,
): Promise<string | null> {
  const session = await ensureAccount(signal);
  return session && isPartyGameBoundaryCurrent(snapshot) && !signal.aborted
    ? session.accountId
    : null;
}

async function flushUnlocked(operationSignal: AbortSignal): Promise<void> {
  const snapshot = capturePartyGameBoundary();
  const abort = combinePartyGameSignals(snapshot.signal, operationSignal);
  try {
    const ownerAccountId = await currentOwner(snapshot, abort.signal);
    if (!ownerAccountId) return;
    if (!(await recoverPartyGameQueuesForAccount(ownerAccountId))) return;
    if (!isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) return;
    const loaded = await runPartyGameQueueMutation(loadPartyGamesQueueState);
    if (
      !loaded.ok ||
      !loaded.state ||
      loaded.state.ownerAccountId !== ownerAccountId ||
      !isPartyGameBoundaryCurrent(snapshot)
    ) return;

    const queue = loaded.state.items.map((item) => ({
      ...item,
      gameId: resolvedGameId(loaded.state!, item.code, item.gameId),
    }));
    const cutoff = Date.now() - MAX_AGE_MS;
    if (queue.length === 0) {
      if (
        loaded.state.aliases.some((alias) => alias.resolvedAt < cutoff) ||
        loaded.state.rejectedStarts.some((rejected) => rejected.rejectedAt < cutoff)
      ) {
        await runPartyGameQueueMutation(async () => {
          if (!isPartyGameBoundaryCurrent(snapshot)) return;
          const current = await loadPartyGamesQueueState();
          if (
            !current.ok ||
            !current.state ||
            current.state.ownerAccountId !== ownerAccountId ||
            !isPartyGameBoundaryCurrent(snapshot)
          ) return;
          await savePartyGamesQueueState({
            ...current.state,
            aliases: current.state.aliases.filter((alias) => alias.resolvedAt >= cutoff),
            rejectedStarts: current.state.rejectedStarts.filter(
              (rejected) => rejected.rejectedAt >= cutoff,
            ),
          });
        });
      }
      return;
    }

    const settled = new Set<string>();
    const fresh = queue.filter((item) => {
      if (item.queuedAt >= cutoff) return true;
      settled.add(item.event.clientId);
      return false;
    });
    const deliverable = fresh.filter((item) => !isLocalPartyGameId(item.gameId));
    for (const batch of batches(deliverable)) {
      if (!isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) return;
      const first = batch[0];
      const result = await sendPartyGameEvents(
        first.code,
        first.gameId,
        batch.map((item) => item.event),
        abort.signal,
        ownerAccountId,
      );
      if (!isPartyGameBoundaryCurrent(snapshot) || abort.signal.aborted) return;
      if (result.ok || !isRetriablePartyGamesError(result)) {
        for (const item of batch) settled.add(item.event.clientId);
      }
    }

    await runPartyGameQueueMutation(async () => {
      if (!isPartyGameBoundaryCurrent(snapshot)) return;
      const current = await loadPartyGamesQueueState();
      if (
        !current.ok ||
        !current.state ||
        current.state.ownerAccountId !== ownerAccountId ||
        !isPartyGameBoundaryCurrent(snapshot)
      ) return;
      await savePartyGamesQueueState({
        ...current.state,
        items: current.state.items.filter((item) => !settled.has(item.event.clientId)),
        aliases: current.state.aliases.filter((alias) => alias.resolvedAt >= cutoff),
        rejectedStarts: current.state.rejectedStarts.filter(
          (rejected) => rejected.rejectedAt >= cutoff,
        ),
      });
    });
  } finally {
    abort.cleanup();
  }
}

const { flush: flushPartyGamesQueue, abortInFlight } = createCoalescingFlush(
  flushUnlocked,
  { protectPrivateAccount: false },
);

export async function enqueuePartyGameEvent(
  code: string,
  gameId: string,
  event: PartyGameEventInput,
): Promise<boolean> {
  const snapshot = capturePartyGameBoundary();
  const ownerAccountId = await currentOwner(snapshot, snapshot.signal);
  if (!ownerAccountId) return false;
  if (!(await recoverPartyGameQueuesForAccount(ownerAccountId))) return false;
  if (!isPartyGameBoundaryCurrent(snapshot)) return false;
  const stored = await runPartyGameQueueMutation(async () => {
    if (!isPartyGameBoundaryCurrent(snapshot)) return false;
    const loaded = await loadPartyGamesQueueState();
    if (!loaded.ok || !isPartyGameBoundaryCurrent(snapshot)) return false;
    const state = stateForOwner(loaded.state, ownerAccountId);
    if (!state) return false;
    if (
      isLocalPartyGameId(gameId) &&
      state.rejectedStarts.some(
        (rejected) => rejected.code === code && rejected.localGameId === gameId,
      )
    ) return false;
    if (state.items.some((existing) => existing.event.clientId === event.clientId)) {
      return true;
    }
    if (state.items.length >= MAX_QUEUE_LENGTH) return false;
    const candidate: PartyGameQueueItem = {
      code,
      gameId: resolvedGameId(state, code, gameId),
      event,
      queuedAt: Date.now(),
    };
    if (!isPartyGameQueueItem(candidate)) return false;
    const cutoff = Date.now() - MAX_AGE_MS;
    return savePartyGamesQueueState({
      ...state,
      items: [...state.items, candidate],
      aliases: state.aliases
        .filter((alias) => alias.resolvedAt >= cutoff)
        .slice(-MAX_ALIASES),
      rejectedStarts: state.rejectedStarts
        .filter((rejected) => rejected.rejectedAt >= cutoff)
        .slice(-MAX_REJECTED_STARTS),
    });
  });
  if (!stored || !isPartyGameBoundaryCurrent(snapshot)) return false;
  await flushPartyGamesQueue();
  return isPartyGameBoundaryCurrent(snapshot);
}

export interface QueuedPartyGameEvent {
  gameId: string;
  event: PartyGameEventInput;
  queuedAt: number;
}

/**
 * Read this account's still-pending events back into a reopened game screen.
 * The queue remains authoritative and untouched; aliases make either the local
 * correlation or the eventual server UUID find the same rows after a restart.
 */
export async function loadQueuedPartyGameEvents(
  code: string,
  gameIds: string[],
): Promise<QueuedPartyGameEvent[]> {
  if (gameIds.length === 0) return [];
  const snapshot = capturePartyGameBoundary();
  const ownerAccountId = await currentOwner(snapshot, snapshot.signal);
  if (!ownerAccountId) return [];
  if (!(await recoverPartyGameQueuesForAccount(ownerAccountId))) return [];
  if (!isPartyGameBoundaryCurrent(snapshot)) return [];
  return runPartyGameQueueMutation(async () => {
    if (!isPartyGameBoundaryCurrent(snapshot)) return [];
    const loaded = await loadPartyGamesQueueState();
    if (
      !loaded.ok ||
      !loaded.state ||
      loaded.state.ownerAccountId !== ownerAccountId ||
      !isPartyGameBoundaryCurrent(snapshot)
    ) return [];
    const normalizedCode = code.toUpperCase();
    const relevantIds = new Set(gameIds);
    for (const alias of loaded.state.aliases) {
      if (alias.code.toUpperCase() !== normalizedCode) continue;
      if (relevantIds.has(alias.localGameId) || relevantIds.has(alias.serverGameId)) {
        relevantIds.add(alias.localGameId);
        relevantIds.add(alias.serverGameId);
      }
    }
    return loaded.state.items.flatMap((item) =>
      item.code.toUpperCase() === normalizedCode && relevantIds.has(item.gameId)
        ? [{ gameId: item.gameId, event: item.event, queuedAt: item.queuedAt }]
        : [],
    );
  });
}

export async function remapQueuedPartyGameEvents(
  code: string,
  localGameId: string,
  serverGameId: string,
  ownerAccountId: string,
): Promise<boolean> {
  const snapshot = capturePartyGameBoundary();
  const saved = await runPartyGameQueueMutation(async () => {
    if (!isPartyGameBoundaryCurrent(snapshot)) return false;
    const loaded = await loadPartyGamesQueueState();
    if (!loaded.ok || !isPartyGameBoundaryCurrent(snapshot)) return false;
    const state = stateForOwner(loaded.state, ownerAccountId);
    if (!state) return false;
    const cutoff = Date.now() - MAX_AGE_MS;
    const aliases = state.aliases.filter(
      (alias) =>
        alias.resolvedAt >= cutoff &&
        !(alias.code === code && alias.localGameId === localGameId),
    );
    aliases.push({ code, localGameId, serverGameId, resolvedAt: Date.now() });
    return savePartyGamesQueueState({
      ...state,
      items: state.items.map((item) =>
        item.code === code && item.gameId === localGameId
          ? { ...item, gameId: serverGameId }
          : item,
      ),
      aliases: aliases.slice(-MAX_ALIASES),
      rejectedStarts: state.rejectedStarts.filter(
        (rejected) => rejected.code !== code || rejected.localGameId !== localGameId,
      ),
    });
  });
  if (!saved || !isPartyGameBoundaryCurrent(snapshot)) return false;
  await flushPartyGamesQueue();
  return isPartyGameBoundaryCurrent(snapshot);
}

/** Remove terminally undeliverable local events and report the exact count. */
export async function discardQueuedPartyGameEvents(
  code: string,
  localGameId: string,
  ownerAccountId: string,
  errorCode: string,
): Promise<{ ok: boolean; discarded: number }> {
  const snapshot = capturePartyGameBoundary();
  return runPartyGameQueueMutation(async () => {
    if (!isPartyGameBoundaryCurrent(snapshot)) return { ok: false, discarded: 0 };
    const loaded = await loadPartyGamesQueueState();
    if (!loaded.ok || !isPartyGameBoundaryCurrent(snapshot)) {
      return { ok: false, discarded: 0 };
    }
    const state = stateForOwner(loaded.state, ownerAccountId);
    if (!state) {
      return { ok: false, discarded: 0 };
    }
    const items = state.items.filter(
      (item) => item.code !== code || item.gameId !== localGameId,
    );
    const discarded = state.items.length - items.length;
    const rejectedStarts = state.rejectedStarts.filter(
      (rejected) => rejected.code !== code || rejected.localGameId !== localGameId,
    );
    rejectedStarts.push({ code, localGameId, errorCode, rejectedAt: Date.now() });
    const ok = await savePartyGamesQueueState({
      ...state,
      items,
      aliases: state.aliases.filter(
        (alias) => alias.code !== code || alias.localGameId !== localGameId,
      ),
      rejectedStarts: rejectedStarts.slice(-MAX_REJECTED_STARTS),
    });
    return { ok, discarded: ok ? discarded : 0 };
  });
}

export { flushPartyGamesQueue };

export function clearPartyGamesQueue(): Promise<void> {
  invalidatePartyGameBoundary();
  abortInFlight();
  return runPartyGameQueueMutation(async () => {
    await savePartyGamesQueueState(null);
  }).then(async () => {
    await clearPartyGameAccountMergeIntentIfQueuesEmpty();
  });
}
