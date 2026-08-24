/**
 * Process-wide account boundary for private local mutations.
 *
 * A credential transition freezes this boundary synchronously, aborts work
 * that captured the previous generation, and waits for every already-started
 * mutation before private storage is removed or re-keyed.  Anonymous account
 * merges additionally persist an operation-bound marker so a process death or
 * a lost HTTP response cannot silently thaw A's queues under an unrelated C.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateCreator } from 'zustand';

// Keep the released phase-0 key so an interrupted upgrade cannot overlook it;
// ownership is global now even though the historical name mentions games.
export const PRIVATE_ACCOUNT_MERGE_STORAGE_KEY = 'na-pivo-party-games-account-merge';
export const LEGACY_PARTY_GAME_ACCOUNT_MERGE_STORAGE_KEY =
  'na-pivo-private-account-merge-v0';

const STORAGE_VERSION = 1;

export interface PrivateAccountMergeIntent {
  version: typeof STORAGE_VERSION;
  operationId: string;
  fromAccountId: string;
  toAccountId: string | null;
  preparedAt: number;
}

export interface PrivateAccountMergePreflight {
  operationId: string;
  /** Only a newly-created, still source-only operation is safe to cancel on 4xx. */
  cancelSafe: boolean;
}

export interface PrivateAccountMutationScope {
  generation: number;
  signal: AbortSignal;
}

export class PrivateAccountMutationFrozenError extends Error {
  constructor() {
    super('Private account mutations are frozen during a credential transition.');
    this.name = 'PrivateAccountMutationFrozenError';
  }
}

interface ActiveTransition {
  id: number;
  ownerAccountId: string | null;
  reason: string;
}

export interface PrivateAccountTransition {
  readonly id: number;
  readonly reason: string;
  bindOwner(accountId: string | null): boolean;
  drain(): Promise<void>;
  release(): void;
}

type FreezeListener = () => void;
type ThawListener = () => void;

let boundaryGeneration = 0;
let boundaryController = new AbortController();
let boundaryFrozen = false;
let durableMarkerBlocks = false;
let deletionRecoveryBlocks = false;
let rehydrationRecoveryBlocks = false;
let activeTransition: ActiveTransition | null = null;
let nextTransitionId = 1;
let activeMutationCount = 0;
let drainWaiters: (() => void)[] = [];
const freezeListeners = new Set<FreezeListener>();
const thawListeners = new Set<ThawListener>();

let mergeIntentCache: PrivateAccountMergeIntent | null | undefined;
let mergeIntentLoad: Promise<{ ok: true; intent: PrivateAccountMergeIntent | null } | { ok: false }> | null = null;

function parseMergeIntent(value: unknown): PrivateAccountMergeIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const intent = value as Partial<PrivateAccountMergeIntent>;
  if (
    intent.version !== STORAGE_VERSION ||
    typeof intent.operationId !== 'string' ||
    !intent.operationId ||
    typeof intent.fromAccountId !== 'string' ||
    !intent.fromAccountId ||
    !(
      intent.toAccountId === null ||
      (typeof intent.toAccountId === 'string' && !!intent.toAccountId)
    ) ||
    typeof intent.preparedAt !== 'number' ||
    !Number.isFinite(intent.preparedAt)
  ) {
    return null;
  }
  return intent as PrivateAccountMergeIntent;
}

function notifyFreeze(): void {
  for (const listener of freezeListeners) {
    try {
      listener();
    } catch {
      // One subsystem must not keep the rest of the account boundary alive.
    }
  }
}

function notifyThaw(): void {
  for (const listener of thawListeners) {
    try {
      listener();
    } catch {
      // A reconnect failure must not keep the account boundary frozen.
    }
  }
}

function recomputeFrozen(): void {
  const shouldFreeze =
    activeTransition !== null ||
    durableMarkerBlocks ||
    deletionRecoveryBlocks ||
    rehydrationRecoveryBlocks;
  if (shouldFreeze === boundaryFrozen) return;
  boundaryFrozen = shouldFreeze;
  boundaryGeneration += 1;
  if (shouldFreeze) {
    boundaryController.abort();
    notifyFreeze();
  } else {
    boundaryController = new AbortController();
    notifyThaw();
  }
}

function setDurableMarkerBlocks(blocks: boolean): void {
  durableMarkerBlocks = blocks;
  recomputeFrozen();
}

/**
 * Freeze the boundary while account-deletion recovery is pending. Independent
 * of the merge marker: clearing this must never thaw a persisted merge block.
 */
export function setPrivateAccountDeletionRecoveryBlocked(blocked: boolean): void {
  deletionRecoveryBlocks = blocked;
  recomputeFrozen();
}

/** Keep every private writer frozen until a failed account rehydrate recovers. */
export function setPrivateAccountRehydrationRecoveryBlocked(blocked: boolean): void {
  rehydrationRecoveryBlocks = blocked;
  recomputeFrozen();
}

function mutationStarted(): void {
  activeMutationCount += 1;
}

function mutationFinished(): void {
  activeMutationCount = Math.max(0, activeMutationCount - 1);
  if (activeMutationCount !== 0) return;
  const waiters = drainWaiters;
  drainWaiters = [];
  for (const resolve of waiters) resolve();
}

async function waitForMutationsToDrain(): Promise<void> {
  if (activeMutationCount !== 0) {
    await new Promise<void>((resolve) => drainWaiters.push(resolve));
  }
  // Let consumers of a just-resolved protected read (notably Zustand
  // hydration) apply their in-memory state before strict cleanup resets it.
  await Promise.resolve();
  await Promise.resolve();
}

function newOperationId(): string {
  const cryptoLike = globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
    };
  };
  if (typeof cryptoLike.crypto?.randomUUID === 'function') {
    return cryptoLike.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoLike.crypto?.getRandomValues === 'function') {
    cryptoLike.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function loadMergeIntentUncached(): Promise<
  { ok: true; intent: PrivateAccountMergeIntent | null } | { ok: false }
> {
  try {
    const currentRaw = await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY);
    if (currentRaw !== null) {
      const parsed = parseMergeIntent(JSON.parse(currentRaw) as unknown);
      if (!parsed) return { ok: false };
      return { ok: true, intent: parsed };
    }

    // Migrate the pre-global party-game marker without ever treating an
    // unreadable payload as empty.  The new write is verified before removal.
    const legacyRaw = await AsyncStorage.getItem(
      LEGACY_PARTY_GAME_ACCOUNT_MERGE_STORAGE_KEY,
    );
    if (legacyRaw === null) return { ok: true, intent: null };
    const parsed = parseMergeIntent(JSON.parse(legacyRaw) as unknown);
    if (!parsed) return { ok: false };
    const serialized = JSON.stringify(parsed);
    await AsyncStorage.setItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY, serialized);
    if ((await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)) !== serialized) {
      return { ok: false };
    }
    await AsyncStorage.removeItem(LEGACY_PARTY_GAME_ACCOUNT_MERGE_STORAGE_KEY);
    if ((await AsyncStorage.getItem(LEGACY_PARTY_GAME_ACCOUNT_MERGE_STORAGE_KEY)) !== null) {
      return { ok: false };
    }
    return { ok: true, intent: parsed };
  } catch {
    return { ok: false };
  }
}

async function loadMergeIntent(): Promise<
  { ok: true; intent: PrivateAccountMergeIntent | null } | { ok: false }
> {
  if (mergeIntentCache !== undefined) {
    return { ok: true, intent: mergeIntentCache };
  }
  if (!mergeIntentLoad) {
    mergeIntentLoad = loadMergeIntentUncached().then((loaded) => {
      if (loaded.ok) {
        mergeIntentCache = loaded.intent;
        setDurableMarkerBlocks(loaded.intent !== null);
      } else {
        // Unknown is not empty. Keep every private producer frozen until the
        // storage problem is explicitly repaired.
        setDurableMarkerBlocks(true);
      }
      return loaded;
    }).finally(() => {
      mergeIntentLoad = null;
    });
  }
  return mergeIntentLoad;
}

async function saveMergeIntent(intent: PrivateAccountMergeIntent | null): Promise<boolean> {
  try {
    if (intent) {
      const serialized = JSON.stringify(intent);
      await AsyncStorage.setItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY, serialized);
      if ((await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)) !== serialized) {
        return false;
      }
    } else {
      await AsyncStorage.removeItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY);
      if ((await AsyncStorage.getItem(PRIVATE_ACCOUNT_MERGE_STORAGE_KEY)) !== null) {
        return false;
      }
    }
    mergeIntentCache = intent;
    setDurableMarkerBlocks(intent !== null);
    return true;
  } catch {
    setDurableMarkerBlocks(true);
    return false;
  }
}

/** Register a synchronous invalidation hook for a subsystem with its own epoch. */
export function registerPrivateAccountFreezeListener(listener: FreezeListener): () => void {
  freezeListeners.add(listener);
  return () => freezeListeners.delete(listener);
}

/** Resume resources that were synchronously invalidated by the account freeze. */
export function registerPrivateAccountThawListener(listener: ThawListener): () => void {
  thawListeners.add(listener);
  return () => thawListeners.delete(listener);
}

export function capturePrivateAccountMutationScope(): PrivateAccountMutationScope {
  return { generation: boundaryGeneration, signal: boundaryController.signal };
}

/** Combine a caller-owned cancellation signal with the account-boundary lease. */
export function combinePrivateAccountMutationSignals(
  scope: PrivateAccountMutationScope,
  operationSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (!operationSignal || operationSignal === scope.signal) {
    return { signal: scope.signal, cleanup: () => undefined };
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of [scope.signal, operationSignal]) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      scope.signal.removeEventListener('abort', abort);
      operationSignal.removeEventListener('abort', abort);
    },
  };
}

export function isPrivateAccountMutationScopeCurrent(
  scope: PrivateAccountMutationScope,
): boolean {
  return (
    !boundaryFrozen &&
    !scope.signal.aborted &&
    scope.generation === boundaryGeneration
  );
}

export function isPrivateAccountMutationFrozen(): boolean {
  return boundaryFrozen;
}

/** Guard every action-level Zustand `set`, not only its later persistence. */
export function guardPrivateAccountStateCreator<T>(
  creator: StateCreator<T, [], []>,
): StateCreator<T, [], []> {
  return (set, get, store) => {
    const guardedSet = ((...args: Parameters<typeof set>) => {
      if (boundaryFrozen) return;
      return set(...args);
    }) as typeof set;
    return creator(guardedSet, get, store);
  };
}

/**
 * Capture a mutation lease immediately at API invocation time. Waiting behind
 * a queue-local mutex remains part of the lease, so a boundary cannot clear A
 * and then let that delayed task persist after B is installed.
 */
export function runPrivateAccountMutation<T>(
  task: (scope: PrivateAccountMutationScope) => Promise<T>,
): Promise<T> {
  const scope = capturePrivateAccountMutationScope();
  if (boundaryFrozen) return Promise.reject(new PrivateAccountMutationFrozenError());
  mutationStarted();
  return (async () => {
    const loaded = await loadMergeIntent();
    if (!loaded.ok || !isPrivateAccountMutationScopeCurrent(scope)) {
      throw new PrivateAccountMutationFrozenError();
    }
    const result = await task(scope);
    if (!isPrivateAccountMutationScopeCurrent(scope)) {
      throw new PrivateAccountMutationFrozenError();
    }
    return result;
  })().finally(mutationFinished);
}

/** Run a destructive queue clear after its owning transition has drained A. */
export function runPrivateAccountCleanupMutation<T>(task: () => Promise<T>): Promise<T> {
  if (!activeTransition) return runPrivateAccountMutation(async () => task());
  mutationStarted();
  return Promise.resolve().then(task).finally(mutationFinished);
}

/** Freeze synchronously; callers must drain before clearing or installing B. */
export function beginPrivateAccountTransition(
  reason: string,
  ownerAccountId: string | null = null,
): PrivateAccountTransition | null {
  if (activeTransition) return null;
  const transition: ActiveTransition = {
    id: nextTransitionId,
    ownerAccountId,
    reason,
  };
  nextTransitionId += 1;
  activeTransition = transition;
  recomputeFrozen();

  return {
    id: transition.id,
    reason,
    bindOwner: (accountId) => {
      if (activeTransition?.id !== transition.id) return false;
      if (
        activeTransition.ownerAccountId &&
        accountId &&
        activeTransition.ownerAccountId !== accountId
      ) return false;
      activeTransition.ownerAccountId = accountId;
      return true;
    },
    drain: () => waitForMutationsToDrain(),
    release: () => {
      if (activeTransition?.id !== transition.id) return;
      activeTransition = null;
      recomputeFrozen();
    },
  };
}

/** Persist/reuse the anonymous A operation before the merge-capable request. */
export async function preflightPrivateAccountMerge(
  transition: PrivateAccountTransition,
  fromAccountId: string,
  canMerge: (fromAccountId: string, toAccountId: string) => Promise<boolean>,
  operationIdFactory: () => string = newOperationId,
): Promise<PrivateAccountMergePreflight | null> {
  if (!transition.bindOwner(fromAccountId)) return null;
  const loaded = await loadMergeIntent();
  if (!loaded.ok) return null;
  if (loaded.intent) {
    if (loaded.intent.fromAccountId !== fromAccountId) return null;
    const safe = await canMerge(
      fromAccountId,
      loaded.intent.toAccountId ?? fromAccountId,
    );
    return safe
      ? { operationId: loaded.intent.operationId, cancelSafe: false }
      : null;
  }
  if (!(await canMerge(fromAccountId, fromAccountId))) return null;
  const intent: PrivateAccountMergeIntent = {
    version: STORAGE_VERSION,
    operationId: operationIdFactory(),
    fromAccountId,
    toAccountId: null,
    preparedAt: Date.now(),
  };
  return (await saveMergeIntent(intent))
    ? { operationId: intent.operationId, cancelSafe: true }
    : null;
}

export async function promotePrivateAccountMerge(
  fromAccountId: string,
  toAccountId: string,
  operationId: string,
  canMerge: (fromAccountId: string, toAccountId: string) => Promise<boolean>,
): Promise<boolean> {
  const loaded = await loadMergeIntent();
  if (
    !loaded.ok ||
    !loaded.intent ||
    loaded.intent.fromAccountId !== fromAccountId ||
    loaded.intent.operationId !== operationId ||
    (loaded.intent.toAccountId !== null && loaded.intent.toAccountId !== toAccountId)
  ) return false;
  if (!(await canMerge(fromAccountId, toAccountId))) return false;
  if (loaded.intent.toAccountId === toAccountId) return true;
  return saveMergeIntent({ ...loaded.intent, toAccountId });
}

export async function cancelUncommittedPrivateAccountMerge(
  fromAccountId: string,
  operationId: string,
): Promise<boolean> {
  const loaded = await loadMergeIntent();
  if (!loaded.ok) return false;
  if (!loaded.intent) return true;
  if (
    loaded.intent.fromAccountId !== fromAccountId ||
    loaded.intent.operationId !== operationId ||
    loaded.intent.toAccountId !== null
  ) return false;
  return saveMergeIntent(null);
}

export async function finalizePrivateAccountMerge(
  fromAccountId: string,
  toAccountId: string,
  operationId: string,
  finalizeLocalData: (intent: PrivateAccountMergeIntent) => Promise<boolean>,
  localDataAlreadyFinalized: (
    fromAccountId: string,
    toAccountId: string,
  ) => Promise<boolean>,
): Promise<boolean> {
  const loaded = await loadMergeIntent();
  if (!loaded.ok) return false;
  if (!loaded.intent) return localDataAlreadyFinalized(fromAccountId, toAccountId);
  if (
    loaded.intent.fromAccountId !== fromAccountId ||
    loaded.intent.operationId !== operationId ||
    loaded.intent.toAccountId !== toAccountId
  ) return false;
  if (!(await finalizeLocalData(loaded.intent))) return false;
  return saveMergeIntent(null);
}

/** Cold-boot recovery: only exact B may finalize; A and unrelated C stay frozen. */
export async function recoverPrivateAccountMerge(
  accountId: string,
  finalizeLocalData: (intent: PrivateAccountMergeIntent) => Promise<boolean>,
): Promise<boolean> {
  const loaded = await loadMergeIntent();
  if (!loaded.ok) return false;
  if (!loaded.intent) return true;
  if (!loaded.intent.toAccountId || loaded.intent.toAccountId !== accountId) return false;

  const ownedTransition = activeTransition
    ? null
    : beginPrivateAccountTransition('merge-recovery', accountId);
  try {
    if (ownedTransition) await ownedTransition.drain();
    if (!(await finalizeLocalData(loaded.intent))) return false;
    return saveMergeIntent(null);
  } finally {
    ownedTransition?.release();
  }
}

/** A pending merge is a durable veto against anonymous 401 eviction/bootstrap. */
export async function privateAccountMergeBlocksAnonymousEviction(
  _accountId?: string | null,
): Promise<boolean> {
  const loaded = await loadMergeIntent();
  if (!loaded.ok) return true;
  if (!loaded.intent) return false;
  // Exact A is the expected caller; an unexpected account is even less safe to
  // evict because it proves a boundary was crossed without resolving the marker.
  return true;
}

export async function readPrivateAccountMergeIntent(): Promise<
  { ok: true; intent: PrivateAccountMergeIntent | null } | { ok: false }
> {
  return loadMergeIntent();
}

/** Reconcile the process cache after a test/strict adapter removed the key. */
export async function refreshPrivateAccountMergeIntentFromStorage(): Promise<boolean> {
  mergeIntentCache = undefined;
  const loaded = await loadMergeIntent();
  return loaded.ok;
}

/** Jest-only process reset; durable AsyncStorage is deliberately untouched. */
export function resetPrivateAccountBoundaryForTests(): void {
  boundaryGeneration = 0;
  boundaryController.abort();
  boundaryController = new AbortController();
  boundaryFrozen = false;
  durableMarkerBlocks = false;
  deletionRecoveryBlocks = false;
  rehydrationRecoveryBlocks = false;
  activeTransition = null;
  nextTransitionId = 1;
  activeMutationCount = 0;
  drainWaiters = [];
  mergeIntentCache = undefined;
  mergeIntentLoad = null;
}
