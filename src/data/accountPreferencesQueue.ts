/**
 * Durable last-write-wins queue for preferences stored on the account.
 *
 * The optimistic values live in settingsStore so controls react immediately.
 * This queue persists the same patch before its first PATCH, binds it to the
 * current account, and removes only fields that were not superseded while a
 * request was in flight.
 */

import {
  ensureAccount,
  updateAccountPreferences,
  type AccountPreferences,
} from './account';
import {
  createCoalescingFlush,
  createQueueLock,
  createQueueStorage,
} from './createQueue';
import {
  PrivateAccountMutationFrozenError,
  registerPrivateAccountFreezeListener,
} from './privateAccountBoundary';
import { suppressPrivatePersistenceDuringMemoryReset } from './privateAccountStorage';
import {
  normalizeAccountPreferencesPatch,
  useSettingsStore,
  type PendingAccountPreferences,
} from '@/stores/settingsStore';

export const ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY =
  'na-pivo-account-preferences-queue';

interface AccountPreferencesQueueItem {
  version: 1;
  ownerAccountId: string | null;
  preferences: PendingAccountPreferences;
  updatedAt: number;
}

function hasPreferences(preferences: PendingAccountPreferences): boolean {
  return Object.keys(preferences).length > 0;
}

function isQueueItem(value: unknown): value is AccountPreferencesQueueItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<AccountPreferencesQueueItem>;
  if (
    item.version !== 1 ||
    !(
      item.ownerAccountId === null ||
      (typeof item.ownerAccountId === 'string' && item.ownerAccountId.length > 0)
    ) ||
    !item.preferences ||
    typeof item.preferences !== 'object' ||
    Array.isArray(item.preferences) ||
    typeof item.updatedAt !== 'number' ||
    !Number.isFinite(item.updatedAt)
  ) {
    return false;
  }
  const normalized = normalizeAccountPreferencesPatch(item.preferences);
  return (
    hasPreferences(normalized) &&
    Object.keys(normalized).length === Object.keys(item.preferences).length
  );
}

const { load, save } = createQueueStorage<AccountPreferencesQueueItem>(
  ACCOUNT_PREFERENCES_QUEUE_STORAGE_KEY,
  isQueueItem,
);
const mutate = createQueueLock();
let queueGeneration = 0;

function currentPending(): {
  ownerAccountId: string | null;
  preferences: PendingAccountPreferences;
} {
  const state = useSettingsStore.getState();
  return {
    ownerAccountId: state.pendingAccountPreferencesOwnerId,
    preferences: normalizeAccountPreferencesPatch(state.pendingAccountPreferences),
  };
}

function mergePreferences(
  older: PendingAccountPreferences,
  newer: PendingAccountPreferences,
): PendingAccountPreferences {
  return { ...older, ...newer };
}

async function loadSingle(): Promise<AccountPreferencesQueueItem | null> {
  return (await load())[0] ?? null;
}

async function saveSingle(item: AccountPreferencesQueueItem | null): Promise<boolean> {
  return save(item ? [item] : []);
}

function ownerMatches(
  queuedOwner: string | null,
  pendingOwner: string | null,
  accountId: string,
): boolean {
  return (
    (queuedOwner === null || queuedOwner === accountId) &&
    (pendingOwner === null || pendingOwner === accountId)
  );
}

async function snapshotForDelivery(
  accountId: string,
  generation: number,
): Promise<AccountPreferencesQueueItem | null> {
  return mutate(async () => {
    if (generation !== queueGeneration) return null;
    const queued = await loadSingle();
    const pending = currentPending();
    if (!queued && !hasPreferences(pending.preferences)) return null;
    if (!ownerMatches(queued?.ownerAccountId ?? null, pending.ownerAccountId, accountId)) {
      // A strict account transition normally clears this state. If a torn or
      // foreign owner survives, fail closed instead of PATCHing it as B.
      return null;
    }

    const preferences = mergePreferences(
      queued?.preferences ?? {},
      pending.preferences,
    );
    if (!hasPreferences(preferences)) return null;
    const item: AccountPreferencesQueueItem = {
      version: 1,
      ownerAccountId: accountId,
      preferences,
      updatedAt: Math.max(queued?.updatedAt ?? 0, Date.now()),
    };
    if (!(await saveSingle(item))) return null;
    if (!useSettingsStore.getState().stageAccountPreferences(preferences, accountId)) {
      return null;
    }
    if (!useSettingsStore.getState().bindPendingAccountPreferencesOwner(accountId)) {
      return null;
    }
    return item;
  });
}

async function removeDeliveredFields(
  attempted: AccountPreferencesQueueItem,
  generation: number,
): Promise<void> {
  await mutate(async () => {
    if (generation !== queueGeneration) return;
    const current = await loadSingle();
    if (!current || current.ownerAccountId !== attempted.ownerAccountId) return;

    const remaining = { ...current.preferences };
    for (const key of Object.keys(attempted.preferences) as (keyof AccountPreferences)[]) {
      if (Object.is(remaining[key], attempted.preferences[key])) delete remaining[key];
    }
    await saveSingle(
      hasPreferences(remaining)
        ? { ...current, preferences: remaining }
        : null,
    );
  });
}

async function flushUnlocked(signal: AbortSignal): Promise<void> {
  const generation = queueGeneration;
  if (signal.aborted) return;
  const session = await ensureAccount(signal);
  if (!session || signal.aborted || generation !== queueGeneration) return;

  const attempted = await snapshotForDelivery(session.accountId, generation);
  if (!attempted || signal.aborted || generation !== queueGeneration) return;

  const updated = await updateAccountPreferences(
    attempted.preferences,
    signal,
    session.accountId,
  );
  if (!updated || signal.aborted || generation !== queueGeneration) return;

  await removeDeliveredFields(attempted, generation);
  if (signal.aborted || generation !== queueGeneration) return;
  useSettingsStore.getState().settlePendingAccountPreferences(
    attempted.preferences,
    session.accountId,
  );
}

const { flush: coalescedFlush, abortInFlight } = createCoalescingFlush(flushUnlocked);

registerPrivateAccountFreezeListener(() => {
  queueGeneration += 1;
  abortInFlight();
});

/** Retry on launch/foreground. Never rejects for a credential freeze. */
export async function flushAccountPreferencesQueue(): Promise<void> {
  try {
    await coalescedFlush();
  } catch (error) {
    if (!(error instanceof PrivateAccountMutationFrozenError)) throw error;
  }
}

/**
 * Optimistically stage and durably persist a server preference before sending.
 * `ownerAccountId` should be the screen's current account when available; a
 * first-run ownerless entry is bound by the first successful ensureAccount().
 */
export function enqueueAccountPreferences(
  preferences: Partial<AccountPreferences>,
  ownerAccountId: string | null = null,
): Promise<boolean> {
  const patch = normalizeAccountPreferencesPatch(preferences);
  if (!hasPreferences(patch)) return Promise.resolve(false);
  if (!useSettingsStore.getState().stageAccountPreferences(patch, ownerAccountId)) {
    return Promise.resolve(false);
  }
  const generation = queueGeneration;

  return mutate(async () => {
    if (generation !== queueGeneration) return false;
    const current = await loadSingle();
    if (
      current?.ownerAccountId &&
      ownerAccountId &&
      current.ownerAccountId !== ownerAccountId
    ) {
      return false;
    }
    const item: AccountPreferencesQueueItem = {
      version: 1,
      ownerAccountId: current?.ownerAccountId ?? ownerAccountId,
      preferences: mergePreferences(current?.preferences ?? {}, patch),
      updatedAt: Date.now(),
    };
    return saveSingle(item);
  }).then(async (persisted) => {
    // Even after a transient queue-storage failure, the separately persisted
    // optimistic overlay lets a foreground flush reconstruct this one-row queue.
    await flushAccountPreferencesQueue();
    return persisted;
  }).catch((error) => {
    if (error instanceof PrivateAccountMutationFrozenError) return false;
    throw error;
  });
}

/** Preserve an anonymous user's pending preference when that account is claimed. */
export async function rekeyAccountPreferencesQueueOwner(
  fromAccountId: string,
  toAccountId: string,
): Promise<boolean> {
  if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) return true;
  try {
    return await mutate(async () => {
      const current = await loadSingle();
      if (!current) {
        const pending = currentPending();
        if (
          pending.ownerAccountId !== null &&
          pending.ownerAccountId !== fromAccountId &&
          pending.ownerAccountId !== toAccountId
        ) return false;
        if (hasPreferences(pending.preferences)) {
          useSettingsStore.setState({ pendingAccountPreferencesOwnerId: toAccountId });
        }
        return true;
      }
      if (
        current.ownerAccountId !== null &&
        current.ownerAccountId !== fromAccountId &&
        current.ownerAccountId !== toAccountId
      ) return false;
      const saved = await saveSingle({ ...current, ownerAccountId: toAccountId });
      if (saved) {
        useSettingsStore.setState({ pendingAccountPreferencesOwnerId: toAccountId });
      }
      return saved;
    });
  } catch (error) {
    if (error instanceof PrivateAccountMutationFrozenError) return false;
    throw error;
  }
}

/** Abort delivery and remove the outgoing account's pending patch. */
export function clearAccountPreferencesQueue(): Promise<boolean> {
  queueGeneration += 1;
  abortInFlight();
  suppressPrivatePersistenceDuringMemoryReset(() => {
    useSettingsStore.setState({
      pendingAccountPreferences: {},
      pendingAccountPreferencesOwnerId: null,
    });
  });
  return mutate(
    () => saveSingle(null),
    { allowDuringPrivateTransition: true },
  );
}

/** Test/debug helper that never exposes preference values. */
export async function hasQueuedAccountPreferences(): Promise<boolean> {
  try {
    return (await mutate(loadSingle)) !== null;
  } catch (error) {
    if (error instanceof PrivateAccountMutationFrozenError) return false;
    throw error;
  }
}
