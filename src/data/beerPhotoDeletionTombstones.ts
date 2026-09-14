/**
 * Durable local deletion intent for beer-photo uploads.
 *
 * This module deliberately knows nothing about the photo store or network
 * queue. Both may import it without creating a store <-> queue cycle. The
 * in-memory set updates synchronously so an upload resolving in the same tick
 * cannot re-add a deleted photo; AsyncStorage makes the decision survive an
 * app restart until the backend confirms its server-side tombstone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { createQueueLock } from './createQueue';

const STORAGE_KEY = 'na-pivo-beer-photo-deletion-tombstones';

export interface BeerPhotoDeletionTombstone {
  clientId: string;
  /** Account public id only — bearer tokens are never persisted. */
  accountId: string;
}

export interface BeerPhotoDeletionRekeyResult {
  persisted: boolean;
  clientIds: string[];
}

export type BeerPhotoDeletionTombstoneLoadResult =
  | { ok: true; tombstones: BeerPhotoDeletionTombstone[] }
  | { ok: false; storageError: true };

function isTombstone(value: unknown): value is BeerPhotoDeletionTombstone {
  const item = value as BeerPhotoDeletionTombstone;
  return (
    !!item &&
    typeof item.clientId === 'string' &&
    item.clientId.length > 0 &&
    typeof item.accountId === 'string' &&
    item.accountId.length > 0
  );
}

const runMutation = createQueueLock({ protectPrivateAccount: false });

/**
 * Privacy markers must fail closed. The generic queue helper intentionally
 * turns read/parse failures into an empty queue, which is convenient for normal
 * retry payloads but unsafe here: `[]` would authorize logout or an account
 * switch and a later save could overwrite markers we never managed to read.
 */
async function loadStrict(): Promise<BeerPhotoDeletionTombstoneLoadResult> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ok: true, tombstones: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isTombstone)) {
      return { ok: false, storageError: true };
    }
    return { ok: true, tombstones: parsed };
  } catch {
    return { ok: false, storageError: true };
  }
}

async function saveStrict(rows: BeerPhotoDeletionTombstone[]): Promise<boolean> {
  try {
    if (rows.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}
/** Pending backend acknowledgements, mirrored in AsyncStorage. */
const pendingClientIds = new Set<string>();
/**
 * Process-lifetime read suppression. A GET response captured before DELETE may
 * settle after the durable marker is acknowledged; keeping this set for the
 * process lifetime prevents that stale snapshot from re-adding the row. Reads
 * remain account-scoped, and after restart the server marker is authoritative.
 */
const suppressedClientIds = new Set<string>();

/** Synchronous read used by upload completion and store reconciliation. */
export function isBeerPhotoDeletionTombstoned(
  clientId: string,
  accountId?: string,
): boolean {
  if (!suppressedClientIds.has(clientId)) return false;
  if (!accountId) return true;
  return pendingRows.some(
    (row) => row.clientId === clientId && row.accountId === accountId,
  ) || acknowledgedSuppressions.has(`${accountId}:${clientId}`);
}

/** True only after the delete intent is safely represented in memory/disk. */
export function isBeerPhotoDeletionPending(clientId: string): boolean {
  return pendingClientIds.has(clientId);
}

let pendingRows: BeerPhotoDeletionTombstone[] = [];
const acknowledgedSuppressions = new Set<string>();

/** Last strict snapshot plus every successfully persisted process-local delete. */
export function getKnownBeerPhotoDeletionTombstones(): BeerPhotoDeletionTombstone[] {
  return [...pendingRows];
}

/** Close the same-tick upload/GET race before account lookup or disk I/O. */
export function suppressBeerPhotoDeletion(clientId: string): void {
  suppressedClientIds.add(clientId);
}

/** Roll back provisional same-tick suppression when no durable row was saved. */
export function cancelBeerPhotoDeletionSuppression(clientId: string): void {
  if (pendingClientIds.has(clientId)) return;
  suppressedClientIds.delete(clientId);
}

/**
 * Hydrate persisted markers without changing the last-known snapshot when the
 * strict read fails. The mutation lock prevents disk read/write interleaving.
 */
export function loadBeerPhotoDeletionTombstones(): Promise<BeerPhotoDeletionTombstoneLoadResult> {
  return runMutation(async () => {
    const loaded = await loadStrict();
    if (!loaded.ok) return loaded;
    const rows = loaded.tombstones;
    pendingRows = rows;
    for (const row of rows) {
      pendingClientIds.add(row.clientId);
      suppressedClientIds.add(row.clientId);
    }
    return { ok: true, tombstones: [...rows] };
  });
}

/**
 * Mark deletion synchronously, then make it durable before the caller removes
 * the upload op or optimistic row. False means persistence failed and the
 * marker was rolled back; the UI must keep the photo and report the failure.
 */
export function queueBeerPhotoDeletionTombstone(
  clientId: string,
  accountId: string,
): Promise<boolean> {
  const hadPending = pendingClientIds.has(clientId);
  pendingClientIds.add(clientId);
  suppressedClientIds.add(clientId);
  return runMutation(async () => {
    const loaded = await loadStrict();
    if (!loaded.ok) {
      if (!hadPending) {
        pendingClientIds.delete(clientId);
        suppressedClientIds.delete(clientId);
      }
      return false;
    }
    const rows = loaded.tombstones;
    const next = [
      ...rows.filter(
        (row) => row.clientId !== clientId || row.accountId !== accountId,
      ),
      { clientId, accountId },
    ];
    const persisted = await saveStrict(next);
    if (!persisted) {
      if (!hadPending) {
        pendingClientIds.delete(clientId);
        suppressedClientIds.delete(clientId);
      }
      return false;
    }
    pendingRows = next;
    return true;
  });
}

/** Drop a local marker only after the backend has durably accepted deletion. */
export function completeBeerPhotoDeletionTombstone(
  clientId: string,
  accountId: string,
): Promise<boolean> {
  return runMutation(async () => {
    const loaded = await loadStrict();
    if (!loaded.ok) return false;
    const rows = loaded.tombstones;
    const next = rows.filter(
      (row) => row.clientId !== clientId || row.accountId !== accountId,
    );
    if (next.length === rows.length) {
      pendingRows = rows;
      if (!rows.some((row) => row.clientId === clientId)) {
        pendingClientIds.delete(clientId);
      }
      acknowledgedSuppressions.add(`${accountId}:${clientId}`);
      return true;
    }
    const persisted = await saveStrict(next);
    if (!persisted) return false;
    pendingRows = next;
    if (!next.some((row) => row.clientId === clientId)) {
      pendingClientIds.delete(clientId);
    }
    acknowledgedSuppressions.add(`${accountId}:${clientId}`);
    return true;
  });
}

/**
 * Move durable deletion intents with an anonymous account after the backend has
 * merged that account into an existing credential-backed one. This is local
 * bookkeeping only; the auth boundary first establishes each privacy action on
 * B directly, so a failed write never decides whether credentials may rotate.
 */
export function rekeyBeerPhotoDeletionTombstones(
  fromAccountId: string,
  toAccountId: string,
): Promise<BeerPhotoDeletionRekeyResult> {
  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
    return Promise.resolve({ persisted: true, clientIds: [] });
  }

  return runMutation(async () => {
    const loaded = await loadStrict();
    if (!loaded.ok) return { persisted: false, clientIds: [] };
    const rows = loaded.tombstones;
    const clientIds = rows
      .filter((row) => row.accountId === fromAccountId)
      .map((row) => row.clientId);
    if (clientIds.length === 0) {
      pendingRows = rows;
      return { persisted: true, clientIds: [] };
    }

    const deduped = new Map<string, BeerPhotoDeletionTombstone>();
    for (const row of rows) {
      const nextRow =
        row.accountId === fromAccountId ? { ...row, accountId: toAccountId } : row;
      deduped.set(`${nextRow.accountId}:${nextRow.clientId}`, nextRow);
    }
    const next = [...deduped.values()];
    const persisted = await saveStrict(next);
    if (!persisted) return { persisted: false, clientIds };

    pendingRows = next;
    for (const clientId of clientIds) {
      acknowledgedSuppressions.delete(`${fromAccountId}:${clientId}`);
    }
    return { persisted: true, clientIds };
  });
}

/** Full storage reset for tests/tooling. Account switches must preserve markers. */
export function clearBeerPhotoDeletionTombstones(): Promise<void> {
  pendingClientIds.clear();
  suppressedClientIds.clear();
  acknowledgedSuppressions.clear();
  pendingRows = [];
  return runMutation(async () => {
    await saveStrict([]);
  });
}
