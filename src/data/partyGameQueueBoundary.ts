/** Shared account boundary and durable storage for both party-game queues. */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { ensureAccount, generateUuidV4 } from './account';
import type { PartyGameEventInput, PartyGameStartInput } from './partyGamesClient';
import { createQueueLock } from './createQueue';
import {
  PRIVATE_ACCOUNT_MERGE_STORAGE_KEY,
  beginPrivateAccountTransition,
  cancelUncommittedPrivateAccountMerge,
  finalizePrivateAccountMerge,
  preflightPrivateAccountMerge,
  promotePrivateAccountMerge,
  readPrivateAccountMergeIntent,
  recoverPrivateAccountMerge,
  refreshPrivateAccountMergeIntentFromStorage,
  registerPrivateAccountFreezeListener,
  type PrivateAccountMergeIntent,
  type PrivateAccountMergePreflight,
  type PrivateAccountTransition,
} from './privateAccountBoundary';

export const PARTY_GAMES_QUEUE_STORAGE_KEY = 'na-pivo-party-games-queue';
export const PARTY_GAME_STARTS_QUEUE_STORAGE_KEY = 'na-pivo-party-game-starts-queue';
/** Backward-compatible export; the marker now protects every private queue. */
export const PARTY_GAME_ACCOUNT_MERGE_STORAGE_KEY = PRIVATE_ACCOUNT_MERGE_STORAGE_KEY;
export const PARTY_GAMES_QUARANTINE_STORAGE_KEY =
  'na-pivo-party-games-queue-quarantine-v1';
export const PARTY_GAME_STARTS_QUARANTINE_STORAGE_KEY =
  'na-pivo-party-game-starts-queue-quarantine-v1';
const STORAGE_VERSION = 1;
const LOCAL_GAME_PREFIX = 'local:';

export interface PartyGameQueueItem {
  code: string;
  gameId: string;
  event: PartyGameEventInput;
  queuedAt: number;
}

export interface PartyGameIdAlias {
  code: string;
  localGameId: string;
  serverGameId: string;
  resolvedAt: number;
}

export interface PartyGameRejectedStart {
  code: string;
  localGameId: string;
  errorCode: string;
  rejectedAt: number;
}

export interface PartyGamesQueueState {
  version: typeof STORAGE_VERSION;
  ownerAccountId: string;
  items: PartyGameQueueItem[];
  aliases: PartyGameIdAlias[];
  rejectedStarts: PartyGameRejectedStart[];
}

export interface PartyGameStartQueueItem {
  code: string;
  input: PartyGameStartInput;
  queuedAt: number;
}

export interface PartyGameStartsQueueState {
  version: typeof STORAGE_VERSION;
  ownerAccountId: string;
  items: PartyGameStartQueueItem[];
}

export type QueueStateLoad<T> =
  | { ok: true; state: T | null }
  | { ok: false };

export interface PartyGameBoundarySnapshot {
  generation: number;
  signal: AbortSignal;
}

export type PartyGameMergePreflight = PrivateAccountMergePreflight;
export type PartyGameMergeLocalFinalizer = (
  intent: PrivateAccountMergeIntent,
) => Promise<boolean>;

/** Both keys share one mutex so an account-merge multiSet cannot race enqueue. */
export const runPartyGameQueueMutation = createQueueLock({ protectPrivateAccount: false });

let boundaryGeneration = 0;
let boundaryController = new AbortController();
const standaloneMergeTransitions = new Map<string, PrivateAccountTransition>();

export function capturePartyGameBoundary(): PartyGameBoundarySnapshot {
  return { generation: boundaryGeneration, signal: boundaryController.signal };
}

export function isPartyGameBoundaryCurrent(snapshot: PartyGameBoundarySnapshot): boolean {
  return snapshot.generation === boundaryGeneration && !snapshot.signal.aborted;
}

/** Synchronously stop old-account bearer acquisition and network delivery. */
export function invalidatePartyGameBoundary(): void {
  boundaryController.abort();
  boundaryGeneration += 1;
  boundaryController = new AbortController();
}

registerPrivateAccountFreezeListener(invalidatePartyGameBoundary);

export function combinePartyGameSignals(
  boundarySignal: AbortSignal,
  operationSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of [boundarySignal, operationSignal]) {
    if (!signal) continue;
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      boundarySignal.removeEventListener('abort', abort);
      operationSignal?.removeEventListener('abort', abort);
    },
  };
}

function isEventInput(value: unknown): value is PartyGameEventInput {
  const event = value as PartyGameEventInput;
  return (
    !!event &&
    typeof event.clientId === 'string' &&
    ['score', 'answer', 'finish', 'action'].includes(event.kind) &&
    (event.subjectId === undefined || typeof event.subjectId === 'string')
  );
}

export function isPartyGameQueueItem(value: unknown): value is PartyGameQueueItem {
  const item = value as PartyGameQueueItem;
  return (
    !!item &&
    typeof item.code === 'string' &&
    typeof item.gameId === 'string' &&
    typeof item.queuedAt === 'number' &&
    isEventInput(item.event)
  );
}

export function isPartyGameIdAlias(value: unknown): value is PartyGameIdAlias {
  const alias = value as PartyGameIdAlias;
  return (
    !!alias &&
    typeof alias.code === 'string' &&
    typeof alias.localGameId === 'string' &&
    alias.localGameId.startsWith(LOCAL_GAME_PREFIX) &&
    typeof alias.serverGameId === 'string' &&
    typeof alias.resolvedAt === 'number'
  );
}

function isPartyGameRejectedStart(value: unknown): value is PartyGameRejectedStart {
  const rejected = value as PartyGameRejectedStart;
  return (
    !!rejected &&
    typeof rejected.code === 'string' &&
    typeof rejected.localGameId === 'string' &&
    rejected.localGameId.startsWith(LOCAL_GAME_PREFIX) &&
    typeof rejected.errorCode === 'string' &&
    typeof rejected.rejectedAt === 'number'
  );
}

export function isPartyGameStartQueueItem(value: unknown): value is PartyGameStartQueueItem {
  const item = value as PartyGameStartQueueItem;
  return (
    !!item &&
    typeof item.code === 'string' &&
    item.code.length <= 16 &&
    typeof item.queuedAt === 'number' &&
    !!item.input &&
    typeof item.input.clientId === 'string' &&
    typeof item.input.catalogKey === 'string' &&
    typeof item.input.name === 'string' &&
    (item.input.rosterIds === undefined ||
      (Array.isArray(item.input.rosterIds) &&
        item.input.rosterIds.length <= 64 &&
        item.input.rosterIds.every((id) => typeof id === 'string') &&
        new Set(item.input.rosterIds).size === item.input.rosterIds.length)) &&
    (item.input.scoring === undefined ||
      item.input.scoring === 'points' ||
      item.input.scoring === 'drinks')
  );
}

function parseGamesState(value: unknown): PartyGamesQueueState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Partial<PartyGamesQueueState>;
  const rejectedStarts = state.rejectedStarts === undefined ? [] : state.rejectedStarts;
  if (
    state.version !== STORAGE_VERSION ||
    typeof state.ownerAccountId !== 'string' ||
    !state.ownerAccountId ||
    !Array.isArray(state.items) ||
    !state.items.every(isPartyGameQueueItem) ||
    !Array.isArray(state.aliases) ||
    !state.aliases.every(isPartyGameIdAlias) ||
    !Array.isArray(rejectedStarts) ||
    !rejectedStarts.every(isPartyGameRejectedStart)
  ) {
    return null;
  }
  return { ...(state as PartyGamesQueueState), rejectedStarts };
}

function parseStartsState(value: unknown): PartyGameStartsQueueState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Partial<PartyGameStartsQueueState>;
  if (
    state.version !== STORAGE_VERSION ||
    typeof state.ownerAccountId !== 'string' ||
    !state.ownerAccountId ||
    !Array.isArray(state.items) ||
    !state.items.every(isPartyGameStartQueueItem)
  ) {
    return null;
  }
  return state as PartyGameStartsQueueState;
}

interface QueueQuarantineEntry {
  raw: string;
  reason: 'ownerless' | 'corrupt' | 'previous-quarantine';
  quarantinedAt: number;
}

interface QueueQuarantineEnvelope {
  version: 1;
  entries: QueueQuarantineEntry[];
}

function readQuarantineEntries(stored: string | null): QueueQuarantineEntry[] {
  if (stored === null) return [];
  try {
    const value = JSON.parse(stored) as Partial<QueueQuarantineEnvelope>;
    if (
      value.version === 1 &&
      Array.isArray(value.entries) &&
      value.entries.every(
        (entry) =>
          !!entry &&
          typeof entry.raw === 'string' &&
          (entry.reason === 'ownerless' ||
            entry.reason === 'corrupt' ||
            entry.reason === 'previous-quarantine') &&
          typeof entry.quarantinedAt === 'number',
      )
    ) return value.entries;
  } catch {
    // Preserve an older/direct or torn quarantine value inside the new envelope.
  }
  return [{ raw: stored, reason: 'previous-quarantine', quarantinedAt: Date.now() }];
}

async function preserveAndRemoveInvalidPayload(
  activeKey: string,
  quarantineKey: string,
  raw: string,
  reason: QueueQuarantineEntry['reason'],
): Promise<boolean> {
  try {
    const entries = readQuarantineEntries(await AsyncStorage.getItem(quarantineKey));
    if (!entries.some((entry) => entry.raw === raw)) {
      entries.push({ raw, reason, quarantinedAt: Date.now() });
    }
    const envelope: QueueQuarantineEnvelope = { version: 1, entries: entries.slice(-8) };
    const serialized = JSON.stringify(envelope);
    await AsyncStorage.setItem(quarantineKey, serialized);
    if ((await AsyncStorage.getItem(quarantineKey)) !== serialized) return false;
    await AsyncStorage.removeItem(activeKey);
    return (await AsyncStorage.getItem(activeKey)) === null;
  } catch {
    return false;
  }
}

async function loadQueueState<T>(
  activeKey: string,
  quarantineKey: string,
  parse: (value: unknown) => T | null,
): Promise<QueueStateLoad<T>> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(activeKey);
  } catch {
    return { ok: false };
  }
  if (raw === null) return { ok: true, state: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
    const state = parse(parsed);
    if (state) return { ok: true, state };
  } catch {
    parsed = null;
  }
  const recovered = await preserveAndRemoveInvalidPayload(
    activeKey,
    quarantineKey,
    raw,
    Array.isArray(parsed) ? 'ownerless' : 'corrupt',
  );
  return recovered ? { ok: true, state: null } : { ok: false };
}

async function quarantineInvalidQueuePayloads(): Promise<boolean> {
  const games = await loadQueueState(
    PARTY_GAMES_QUEUE_STORAGE_KEY,
    PARTY_GAMES_QUARANTINE_STORAGE_KEY,
    parseGamesState,
  );
  if (!games.ok) return false;
  const starts = await loadQueueState(
    PARTY_GAME_STARTS_QUEUE_STORAGE_KEY,
    PARTY_GAME_STARTS_QUARANTINE_STORAGE_KEY,
    parseStartsState,
  );
  return starts.ok;
}

async function saveStrict(
  key: string,
  state: { items: unknown[]; aliases?: unknown[]; rejectedStarts?: unknown[] } | null,
): Promise<boolean> {
  try {
    if (
      !state ||
      (
        state.items.length === 0 &&
        (!state.aliases || state.aliases.length === 0) &&
        (!state.rejectedStarts || state.rejectedStarts.length === 0)
      )
    ) {
      await AsyncStorage.removeItem(key);
    } else {
      await AsyncStorage.setItem(key, JSON.stringify(state));
    }
    return true;
  } catch {
    return false;
  }
}

export function newPartyGamesQueueState(ownerAccountId: string): PartyGamesQueueState {
  return {
    version: STORAGE_VERSION,
    ownerAccountId,
    items: [],
    aliases: [],
    rejectedStarts: [],
  };
}

export function newPartyGameStartsQueueState(ownerAccountId: string): PartyGameStartsQueueState {
  return { version: STORAGE_VERSION, ownerAccountId, items: [] };
}

export async function loadPartyGamesQueueState(): Promise<QueueStateLoad<PartyGamesQueueState>> {
  return loadQueueState(
    PARTY_GAMES_QUEUE_STORAGE_KEY,
    PARTY_GAMES_QUARANTINE_STORAGE_KEY,
    parseGamesState,
  );
}

export function savePartyGamesQueueState(state: PartyGamesQueueState | null): Promise<boolean> {
  return saveStrict(PARTY_GAMES_QUEUE_STORAGE_KEY, state);
}

export async function loadPartyGameStartsQueueState(): Promise<QueueStateLoad<PartyGameStartsQueueState>> {
  return loadQueueState(
    PARTY_GAME_STARTS_QUEUE_STORAGE_KEY,
    PARTY_GAME_STARTS_QUARANTINE_STORAGE_KEY,
    parseStartsState,
  );
}

export function savePartyGameStartsQueueState(
  state: PartyGameStartsQueueState | null,
): Promise<boolean> {
  return saveStrict(PARTY_GAME_STARTS_QUEUE_STORAGE_KEY, state);
}

function rekeyIds(ids: string[] | undefined, fromAccountId: string, toAccountId: string) {
  if (!ids) return undefined;
  return [...new Set(ids.map((id) => (id === fromAccountId ? toAccountId : id)))];
}

function gamesStateForMerge(
  value: unknown,
  fromAccountId: string,
  toAccountId: string,
): PartyGamesQueueState | null | false {
  const parsed = parseGamesState(value);
  if (!parsed) return false;
  const state = parsed;
  if (state.ownerAccountId !== fromAccountId && state.ownerAccountId !== toAccountId) return false;
  return {
    ...state,
    ownerAccountId: toAccountId,
    items: state.items.map((item) => ({
      ...item,
      event: item.event.subjectId === fromAccountId
        ? { ...item.event, subjectId: toAccountId }
        : item.event,
    })),
  };
}

function startsStateForMerge(
  value: unknown,
  fromAccountId: string,
  toAccountId: string,
): PartyGameStartsQueueState | null | false {
  const parsed = parseStartsState(value);
  if (!parsed) return false;
  const state = parsed;
  if (state.ownerAccountId !== fromAccountId && state.ownerAccountId !== toAccountId) return false;
  return {
    ...state,
    ownerAccountId: toAccountId,
    items: state.items.map((item) => ({
      ...item,
      input: {
        ...item.input,
        ...(item.input.rosterIds
          ? { rosterIds: rekeyIds(item.input.rosterIds, fromAccountId, toAccountId) }
          : {}),
      },
    })),
  };
}

async function queueSnapshotsCanMerge(
  fromAccountId: string,
  toAccountId: string,
): Promise<boolean> {
  try {
    if (!(await quarantineInvalidQueuePayloads())) return false;
    const rows = await AsyncStorage.multiGet([
      PARTY_GAMES_QUEUE_STORAGE_KEY,
      PARTY_GAME_STARTS_QUEUE_STORAGE_KEY,
    ]);
    const rawByKey = new Map(rows);
    const gamesRaw = rawByKey.get(PARTY_GAMES_QUEUE_STORAGE_KEY) ?? null;
    const startsRaw = rawByKey.get(PARTY_GAME_STARTS_QUEUE_STORAGE_KEY) ?? null;
    const games = gamesRaw === null
      ? null
      : gamesStateForMerge(JSON.parse(gamesRaw) as unknown, fromAccountId, toAccountId);
    const starts = startsRaw === null
      ? null
      : startsStateForMerge(JSON.parse(startsRaw) as unknown, fromAccountId, toAccountId);
    return games !== false && starts !== false;
  } catch {
    return false;
  }
}

async function queueSnapshotsAreFinalized(
  fromAccountId: string,
  toAccountId: string,
): Promise<boolean> {
  try {
    if (!(await quarantineInvalidQueuePayloads())) return false;
    const rows = await AsyncStorage.multiGet([
      PARTY_GAMES_QUEUE_STORAGE_KEY,
      PARTY_GAME_STARTS_QUEUE_STORAGE_KEY,
    ]);
    const rawByKey = new Map(rows);
    const gamesRaw = rawByKey.get(PARTY_GAMES_QUEUE_STORAGE_KEY) ?? null;
    const startsRaw = rawByKey.get(PARTY_GAME_STARTS_QUEUE_STORAGE_KEY) ?? null;
    const games = gamesRaw === null
      ? null
      : parseGamesState(JSON.parse(gamesRaw) as unknown);
    const starts = startsRaw === null
      ? null
      : parseStartsState(JSON.parse(startsRaw) as unknown);
    if ((gamesRaw !== null && !games) || (startsRaw !== null && !starts)) return false;
    if (games && games.ownerAccountId !== toAccountId) return false;
    if (starts && starts.ownerAccountId !== toAccountId) return false;
    if (
      fromAccountId !== toAccountId &&
      games?.items.some((item) => item.event.subjectId === fromAccountId)
    ) return false;
    if (
      fromAccountId !== toAccountId &&
      starts?.items.some((item) => item.input.rosterIds?.includes(fromAccountId))
    ) return false;
    return true;
  } catch {
    return false;
  }
}

async function finalizeMergeLocked(intent: PrivateAccountMergeIntent): Promise<boolean> {
  if (!intent.toAccountId) return false;
  try {
    if (!(await quarantineInvalidQueuePayloads())) return false;
    const rows = await AsyncStorage.multiGet([
      PARTY_GAMES_QUEUE_STORAGE_KEY,
      PARTY_GAME_STARTS_QUEUE_STORAGE_KEY,
    ]);
    const rawByKey = new Map(rows);
    const gamesRaw = rawByKey.get(PARTY_GAMES_QUEUE_STORAGE_KEY) ?? null;
    const startsRaw = rawByKey.get(PARTY_GAME_STARTS_QUEUE_STORAGE_KEY) ?? null;
    const games = gamesRaw === null
      ? null
      : gamesStateForMerge(
          JSON.parse(gamesRaw) as unknown,
          intent.fromAccountId,
          intent.toAccountId,
        );
    const starts = startsRaw === null
      ? null
      : startsStateForMerge(
          JSON.parse(startsRaw) as unknown,
          intent.fromAccountId,
          intent.toAccountId,
        );
    if (games === false || starts === false) return false;

    const writes: [string, string][] = [];
    if (games) writes.push([PARTY_GAMES_QUEUE_STORAGE_KEY, JSON.stringify(games)]);
    if (starts) writes.push([PARTY_GAME_STARTS_QUEUE_STORAGE_KEY, JSON.stringify(starts)]);
    if (writes.length > 0) {
      await AsyncStorage.multiSet(writes);
      const verified = new Map(await AsyncStorage.multiGet(writes.map(([key]) => key)));
      if (!writes.every(([key, value]) => verified.get(key) === value)) return false;
    }
    // The global boundary verifies these writes before removing its marker.
    // A kill here is harmless: exact B repeats the idempotent re-key on boot.
    return queueSnapshotsAreFinalized(intent.fromAccountId, intent.toAccountId);
  } catch {
    return false;
  }
}

/**
 * Phase 0, before any merge-capable auth request: durably freeze A while the
 * target is still unknown. A failed write blocks the request itself.
 */
export async function preflightPartyGameQueuesForAccountMerge(
  fromAccountId: string,
  transition?: PrivateAccountTransition,
): Promise<PartyGameMergePreflight | null> {
  if (!fromAccountId) return null;
  const reusableStandalone = transition
    ? null
    : standaloneMergeTransitions.values().next().value as
      | PrivateAccountTransition
      | undefined;
  const ownedTransition = transition ?? reusableStandalone ?? beginPrivateAccountTransition(
    'party-game-account-merge',
    fromAccountId,
  );
  if (!ownedTransition) return null;
  invalidatePartyGameBoundary();
  await ownedTransition.drain();
  const session = await ensureAccount(boundaryController.signal);
  if (!session || session.accountId !== fromAccountId) {
    if (!transition) ownedTransition.release();
    return null;
  }
  const result = await runPartyGameQueueMutation(() =>
    preflightPrivateAccountMerge(
      ownedTransition,
      fromAccountId,
      queueSnapshotsCanMerge,
      generateUuidV4,
    ));
  if (!transition) {
    if (result) standaloneMergeTransitions.set(result.operationId, ownedTransition);
    else ownedTransition.release();
  }
  return result;
}

/** Phase 1, after a successful auth response identifies B, still before setSession. */
export async function promotePartyGameQueuesAccountMerge(
  fromAccountId: string,
  toAccountId: string,
  operationId: string,
): Promise<boolean> {
  if (!fromAccountId || !toAccountId || !operationId) return false;
  invalidatePartyGameBoundary();
  const session = await ensureAccount(boundaryController.signal);
  if (!session || session.accountId !== fromAccountId) return false;
  return runPartyGameQueueMutation(() =>
    promotePrivateAccountMerge(
      fromAccountId,
      toAccountId,
      operationId,
      queueSnapshotsCanMerge,
    ));
}

/** Clear only a source-only intent when the server definitely did not merge. */
export async function cancelUncommittedPartyGameAccountMerge(
  fromAccountId: string,
  operationId: string,
): Promise<boolean> {
  invalidatePartyGameBoundary();
  const session = await ensureAccount(boundaryController.signal);
  if (!session || session.accountId !== fromAccountId) return false;
  const cancelled = await runPartyGameQueueMutation(() =>
    cancelUncommittedPrivateAccountMerge(fromAccountId, operationId));
  if (cancelled) {
    standaloneMergeTransitions.get(operationId)?.release();
    standaloneMergeTransitions.delete(operationId);
  }
  return cancelled;
}

/** Phase 2, only after B's bearer is durably installed. */
export async function finalizePartyGameQueuesForAccountMerge(
  fromAccountId: string,
  toAccountId: string,
  operationId: string,
  finalizeAdditionalLocalData: PartyGameMergeLocalFinalizer,
): Promise<boolean> {
  invalidatePartyGameBoundary();
  const session = await ensureAccount(boundaryController.signal);
  if (!session || session.accountId !== toAccountId) return false;
  const finalized = await runPartyGameQueueMutation(() =>
    finalizePrivateAccountMerge(
      fromAccountId,
      toAccountId,
      operationId,
      async (intent) => {
        if (!(await finalizeAdditionalLocalData(intent))) return false;
        return finalizeMergeLocked(intent);
      },
      queueSnapshotsAreFinalized,
    ));
  if (finalized) {
    standaloneMergeTransitions.get(operationId)?.release();
    standaloneMergeTransitions.delete(operationId);
  }
  return finalized;
}

/**
 * Ordinary queue work may only proceed with no global merge marker. Startup
 * recovery supplies the full private-data finalizer; without it, B must not
 * complete only the game subset and strand the rest of A's account data.
 */
export async function recoverPartyGameQueuesForAccount(
  accountId: string,
  finalizeAdditionalLocalData?: PartyGameMergeLocalFinalizer,
): Promise<boolean> {
  return runPartyGameQueueMutation(async () => {
    if (!finalizeAdditionalLocalData) {
      const merge = await readPrivateAccountMergeIntent();
      return merge.ok && merge.intent === null;
    }
    return recoverPrivateAccountMerge(accountId, async (intent) => {
      if (
        !(await finalizeAdditionalLocalData(intent))
      ) return false;
      return finalizeMergeLocked(intent);
    });
  });
}

/**
 * Queue clears must never cancel a real unresolved merge. They only reconcile
 * the process cache when the durable marker is already physically absent (the
 * Jest adapter and strict private clear both remove keys out-of-band).
 */
export async function clearPartyGameAccountMergeIntentIfQueuesEmpty(): Promise<boolean> {
  return runPartyGameQueueMutation(async () => {
    try {
      if ((await AsyncStorage.getItem(PARTY_GAME_ACCOUNT_MERGE_STORAGE_KEY)) !== null) {
        return true;
      }
      for (const transition of standaloneMergeTransitions.values()) transition.release();
      standaloneMergeTransitions.clear();
      return refreshPrivateAccountMergeIntentFromStorage();
    } catch {
      return false;
    }
  });
}
