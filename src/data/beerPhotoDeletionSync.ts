/** Account-scoped network delivery for durable beer-photo deletion markers. */

import { ensureAccount, type AccountSession } from './account';
import {
  completeBeerPhotoDeletionTombstone,
  getKnownBeerPhotoDeletionTombstones,
  loadBeerPhotoDeletionTombstones,
  rekeyBeerPhotoDeletionTombstones,
} from './beerPhotoDeletionTombstones';
import { deleteBeerPhotoByClientId } from './beerPhotosClient';

const DEFAULT_DEADLINE_MS = 3_000;
const MAX_CONCURRENT_DELETIONS = 3;

/** Bearers stay memory-only and are never serialized with the tombstone. */
const capturedSessions = new Map<string, AccountSession>();

function settleBeforeAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => finish(value),
      () => finish(null),
    );
  });
}

export interface BeerPhotoDeletionFlushResult {
  attempted: number;
  delivered: number;
  /** Durable markers still waiting, or null when storage/ownership is unknown. */
  remaining: number | null;
  timedOut: boolean;
  /** A strict tombstone read failed; callers must fail closed. */
  storageError?: true;
}

interface FlushOptions {
  /** Exact outgoing credential captured before an auth/session transition. */
  session?: AccountSession | null;
  /** The caller has just installed this credential and knows it is newest. */
  preferProvidedSession?: boolean;
  /** Test hook and hard upper bound for logout/auth UX. */
  deadlineMs?: number;
}

export function rememberBeerPhotoDeletionSession(
  clientId: string,
  session: AccountSession,
): void {
  capturedSessions.set(clientId, session);
}

export function getBeerPhotoDeletionSession(
  clientId: string,
): AccountSession | undefined {
  return capturedSessions.get(clientId);
}

/**
 * Prefer the live credential when it belongs to the marker's account. A token
 * captured when Delete was tapped can expire before re-authentication; using it
 * forever would strand an otherwise deliverable privacy action.
 */
export function getPreferredBeerPhotoDeletionSession(
  clientId: string,
  accountId: string,
  currentSession?: AccountSession | null,
): AccountSession | undefined {
  if (currentSession?.accountId === accountId) return currentSession;
  const captured = capturedSessions.get(clientId);
  return captured?.accountId === accountId ? captured : undefined;
}

export function forgetBeerPhotoDeletionSession(clientId: string): void {
  capturedSessions.delete(clientId);
}

export function forgetAllBeerPhotoDeletionSessions(): void {
  capturedSessions.clear();
}

/**
 * The backend atomically folds an anonymous account into the authenticated
 * target. Move the phone's unsent markers to the same owner before installing
 * the new session, then forget the now-revoked anonymous bearers.
 */
export async function rekeyBeerPhotoDeletionsForAccountMerge(
  fromAccountId: string,
  toAccountId: string,
): Promise<boolean> {
  const result = await rekeyBeerPhotoDeletionTombstones(fromAccountId, toAccountId);
  if (!result.persisted) return false;
  for (const clientId of result.clientIds) capturedSessions.delete(clientId);
  return true;
}

async function deliverWithSession(
  tombstones: Array<{ clientId: string; accountId: string }>,
  session: AccountSession,
  signal: AbortSignal,
): Promise<{ attempted: number; deliveredClientIds: Set<string> }> {
  let attempted = 0;
  const deliveredClientIds = new Set<string>();
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (!signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const tombstone = tombstones[index];
      if (!tombstone) return;
      attempted += 1;
      if (await deleteBeerPhotoByClientId(tombstone.clientId, signal, session)) {
        deliveredClientIds.add(tombstone.clientId);
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_DELETIONS, tombstones.length) },
      () => worker(),
    ),
  );
  return { attempted, deliveredClientIds };
}

/**
 * The auth endpoint has already merged anonymous A into credential account B.
 * Establish every late A/B deletion directly on B with the response bearer
 * before SecureStore can fail. Server acknowledgement is the safety boundary;
 * an unacknowledged marker remains under A with its captured A bearer.
 */
export async function flushBeerPhotoDeletionsForAccountMerge(
  fromAccountId: string,
  toAccountId: string,
  incomingSession: AccountSession,
  options: {
    deadlineMs?: number;
    /** Valid only after a strict, clean pre-auth flush in this process. */
    strictPreflightClean?: boolean;
  } = {},
): Promise<BeerPhotoDeletionFlushResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, options.deadlineMs ?? DEFAULT_DEADLINE_MS));

  try {
    const initial = await settleBeforeAbort(
      loadBeerPhotoDeletionTombstones(),
      controller.signal,
    );
    if (!initial) {
      return {
        attempted: 0,
        delivered: 0,
        remaining: null,
        timedOut,
        storageError: true,
      };
    }
    const initialStorageError = !initial.ok;
    if (!initial.ok && !options.strictPreflightClean) {
      return {
        attempted: 0,
        delivered: 0,
        remaining: null,
        timedOut,
        storageError: true,
      };
    }

    // If storage became unreadable only after a strict empty preflight, every
    // new marker must have been persisted by this process and is present in the
    // in-memory snapshot. This closes the auth-response race without treating a
    // general read failure as empty.
    const initialRows = initial.ok
      ? initial.tombstones
      : getKnownBeerPhotoDeletionTombstones();
    const initialRelevant = initialRows.filter(
      (row) => row.accountId === fromAccountId || row.accountId === toAccountId,
    );
    if (initialRelevant.length === 0) {
      return {
        attempted: 0,
        delivered: 0,
        remaining: 0,
        timedOut,
        ...(initialStorageError ? { storageError: true as const } : {}),
      };
    }

    // Do not rekey A before B has acknowledged the privacy action. If B DELETE
    // fails, auth keeps the durable A marker and its captured A bearer so the
    // next strict preflight still blocks instead of creating an unreachable B
    // marker while SecureStore continues to hold A.
    const storageError = initialStorageError;
    const rows = initialRelevant;
    const uniqueRows = [
      ...new Map(rows.map((row) => [row.clientId, row] as const)).values(),
    ];
    if (controller.signal.aborted) {
      return {
        attempted: 0,
        delivered: 0,
        remaining: uniqueRows.length,
        timedOut,
        ...(storageError ? { storageError: true as const } : {}),
      };
    }

    const delivery = await deliverWithSession(
      uniqueRows,
      incomingSession,
      controller.signal,
    );
    const delivered = delivery.deliveredClientIds.size;

    // Server B now owns the durable privacy action. Local cleanup is best
    // effort and never changes whether the credential transition is safe.
    for (const row of rows) {
      if (!delivery.deliveredClientIds.has(row.clientId)) continue;
      const completed = await settleBeforeAbort(
        completeBeerPhotoDeletionTombstone(
          row.clientId,
          row.accountId,
        ),
        controller.signal,
      );
      if (completed) capturedSessions.delete(row.clientId);
    }

    return {
      attempted: delivery.attempted,
      delivered,
      remaining: Math.max(0, uniqueRows.length - delivered),
      timedOut,
      ...(storageError ? { storageError: true as const } : {}),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Deliver current-account deletion markers before a session can be replaced or
 * revoked. Work is capped at three requests and one short global deadline, so a
 * blackholed API cannot freeze logout once per queued marker. The result is
 * truthful: callers can block a destructive session transition while `remaining`
 * is non-zero, and every undelivered marker stays durable for a later retry.
 */
export async function flushBeerPhotoDeletionsBeforeSessionEnd(
  options: FlushOptions = {},
): Promise<BeerPhotoDeletionFlushResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, options.deadlineMs ?? DEFAULT_DEADLINE_MS));

  let attempted = 0;
  let delivered = 0;
  let accountId = options.session?.accountId ?? '';

  try {
    const observedSession = options.preferProvidedSession
      ? null
      : await ensureAccount(controller.signal);
    const session =
      options.preferProvidedSession && options.session
        ? options.session
        : observedSession && observedSession.accountId === options.session?.accountId
          ? observedSession
          : options.session ?? observedSession;
    if (session && !controller.signal.aborted) {
      accountId = session.accountId;

      const loaded = await settleBeforeAbort(
        loadBeerPhotoDeletionTombstones(),
        controller.signal,
      );
      if (!loaded) {
        return {
          attempted: 0,
          delivered: 0,
          remaining: null,
          timedOut,
          storageError: true,
        };
      }
      if (!loaded.ok) {
        return {
          attempted: 0,
          delivered: 0,
          remaining: null,
          timedOut,
          storageError: true,
        };
      }
      const tombstones = loaded.tombstones.filter(
        (row) => row.accountId === accountId,
      );
      const deliverable = tombstones.flatMap((tombstone) => {
        const deliverySession = getPreferredBeerPhotoDeletionSession(
          tombstone.clientId,
          tombstone.accountId,
          session,
        );
        return deliverySession ? [{ tombstone, deliverySession }] : [];
      });

      // All rows here share the selected account/session. Per-row captured
      // tokens are only a fallback when no live matching credential exists.
      const liveRows = deliverable.filter(
        ({ deliverySession }) => deliverySession.token === session.token,
      );
      const delivery = await deliverWithSession(
        liveRows.map(({ tombstone }) => tombstone),
        session,
        controller.signal,
      );
      attempted += delivery.attempted;
      delivered += delivery.deliveredClientIds.size;
      for (const tombstone of tombstones) {
        if (!delivery.deliveredClientIds.has(tombstone.clientId)) continue;
        const completed = await settleBeforeAbort(
          completeBeerPhotoDeletionTombstone(
            tombstone.clientId,
            tombstone.accountId,
          ),
          controller.signal,
        );
        if (completed) capturedSessions.delete(tombstone.clientId);
      }
    }

    const finalLoad = await settleBeforeAbort(
      loadBeerPhotoDeletionTombstones(),
      controller.signal,
    );
    if (!finalLoad || !finalLoad.ok) {
      return {
        attempted,
        delivered,
        remaining: null,
        timedOut,
        storageError: true,
      };
    }
    const remaining = accountId
      ? finalLoad.tombstones.filter((row) => row.accountId === accountId).length
      : finalLoad.tombstones.length === 0
        ? 0
        : null;
    return { attempted, delivered, remaining, timedOut };
  } finally {
    clearTimeout(timeoutId);
  }
}
