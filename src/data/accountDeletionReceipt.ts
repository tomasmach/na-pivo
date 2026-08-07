import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Durable client half of the account-deletion idempotency protocol.
 *
 * `active` is written before DELETE leaves the phone. Old operations whose
 * owner is no longer the durable session move to an orphan ledger: this
 * retains their public status capability for a late server commit without
 * permanently occupying the active slot for the current account.
 */
export const ACCOUNT_DELETION_RECEIPT_KEY = 'na-pivo-account-deletion-intent-v2';

export interface AccountDeletionIntent {
  accountId: string;
  operationId: string;
  phase: 'pending' | 'complete';
}

export interface AccountDeletionOrphan extends AccountDeletionIntent {
  archivedAt: number;
}

interface StoredAccountDeletionState {
  version: 3;
  active: AccountDeletionIntent | null;
  orphans: AccountDeletionOrphan[];
}

interface LegacyStoredAccountDeletionIntent extends AccountDeletionIntent {
  version: 2;
}

export type AccountDeletionReceiptReadResult =
  | {
      ok: true;
      intent: AccountDeletionIntent | null;
      orphans: AccountDeletionOrphan[];
    }
  | { ok: false; storageError: true };

export type AccountDeletionReceiptWriteResult =
  | { ok: true }
  | { ok: false; storageError: true };

function isIntent(value: unknown): value is AccountDeletionIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const intent = value as Partial<AccountDeletionIntent>;
  return (
    typeof intent.accountId === 'string' &&
    intent.accountId.length > 0 &&
    typeof intent.operationId === 'string' &&
    intent.operationId.length > 0 &&
    (intent.phase === 'pending' || intent.phase === 'complete')
  );
}

function parseState(raw: string): StoredAccountDeletionState | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Partial<LegacyStoredAccountDeletionIntent>).version === 2 &&
      isIntent(value)
    ) {
      const legacy = value as LegacyStoredAccountDeletionIntent;
      return {
        version: 3,
        active: {
          accountId: legacy.accountId,
          operationId: legacy.operationId,
          phase: legacy.phase,
        },
        orphans: [],
      };
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const state = value as Partial<StoredAccountDeletionState>;
    if (
      state.version !== 3 ||
      !(state.active === null || isIntent(state.active)) ||
      !Array.isArray(state.orphans)
    ) {
      return null;
    }
    const orphanKeys = new Set<string>();
    const orphans: AccountDeletionOrphan[] = [];
    for (const candidate of state.orphans) {
      if (
        !isIntent(candidate) ||
        typeof (candidate as Partial<AccountDeletionOrphan>).archivedAt !== 'number' ||
        !Number.isFinite((candidate as AccountDeletionOrphan).archivedAt) ||
        (candidate as AccountDeletionOrphan).archivedAt < 0
      ) {
        return null;
      }
      const orphan = candidate as AccountDeletionOrphan;
      const key = `${orphan.accountId}\u0000${orphan.operationId}`;
      if (orphanKeys.has(key)) return null;
      orphanKeys.add(key);
      orphans.push({ ...orphan });
    }
    if (
      state.active &&
      orphanKeys.has(`${state.active.accountId}\u0000${state.active.operationId}`)
    ) {
      return null;
    }
    return {
      version: 3,
      active: state.active ? { ...state.active } : null,
      orphans,
    };
  } catch {
    return null;
  }
}

async function persistState(state: StoredAccountDeletionState): Promise<boolean> {
  try {
    if (state.active === null && state.orphans.length === 0) {
      await AsyncStorage.removeItem(ACCOUNT_DELETION_RECEIPT_KEY);
      return (await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) === null;
    }
    const serialized = JSON.stringify(state);
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, serialized);
    return (await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) === serialized;
  } catch {
    return false;
  }
}

export async function readAccountDeletionReceipt(): Promise<AccountDeletionReceiptReadResult> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY);
    if (raw === null) return { ok: true, intent: null, orphans: [] };
    const state = parseState(raw);
    return state
      ? {
          ok: true,
          intent: state.active ? { ...state.active } : null,
          orphans: state.orphans.map((orphan) => ({ ...orphan })),
        }
      : { ok: false, storageError: true };
  } catch {
    return { ok: false, storageError: true };
  }
}

function stateFromRead(
  read: Extract<AccountDeletionReceiptReadResult, { ok: true }>,
): StoredAccountDeletionState {
  return {
    version: 3,
    active: read.intent ? { ...read.intent } : null,
    orphans: read.orphans.map((orphan) => ({ ...orphan })),
  };
}

/** Persist the operation before the first DELETE. Never overwrites another active intent. */
export async function writeAccountDeletionReceipt(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  if (!accountId || !operationId) return { ok: false, storageError: true };
  const existing = await readAccountDeletionReceipt();
  if (!existing.ok || existing.intent !== null) {
    return { ok: false, storageError: true };
  }
  const state = stateFromRead(existing);
  state.active = { accountId, operationId, phase: 'pending' };
  return (await persistState(state))
    ? { ok: true }
    : { ok: false, storageError: true };
}

/** Upgrade only the exact active operation after server 204/status proof. */
export async function completeAccountDeletionReceipt(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  const existing = await readAccountDeletionReceipt();
  if (
    !existing.ok ||
    existing.intent?.accountId !== accountId ||
    existing.intent.operationId !== operationId
  ) {
    return { ok: false, storageError: true };
  }
  if (existing.intent.phase === 'complete') return { ok: true };
  const state = stateFromRead(existing);
  state.active = { accountId, operationId, phase: 'complete' };
  return (await persistState(state))
    ? { ok: true }
    : { ok: false, storageError: true };
}

/** Remove only an exact completed active operation after the local boundary. */
export async function clearAccountDeletionReceipt(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  const current = await readAccountDeletionReceipt();
  if (!current.ok) return { ok: false, storageError: true };
  if (current.intent === null) return { ok: true };
  if (
    current.intent.accountId !== accountId ||
    current.intent.operationId !== operationId ||
    current.intent.phase !== 'complete'
  ) {
    return { ok: false, storageError: true };
  }
  const state = stateFromRead(current);
  state.active = null;
  return (await persistState(state))
    ? { ok: true }
    : { ok: false, storageError: true };
}

/**
 * Move an exact stale active operation out of the current account's slot.
 * Unresolved capabilities are intentionally never evicted or capped. Account
 * deletion is a rare explicit action, and a few tiny rows cost less than
 * permanently blocking a current account after several old operations remain
 * incomplete forever.
 */
export async function archiveAccountDeletionReceipt(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  const current = await readAccountDeletionReceipt();
  if (!current.ok) return { ok: false, storageError: true };
  if (current.intent === null) {
    return current.orphans.some(
      (orphan) => orphan.accountId === accountId && orphan.operationId === operationId,
    )
      ? { ok: true }
      : { ok: false, storageError: true };
  }
  if (
    current.intent.accountId !== accountId ||
    current.intent.operationId !== operationId
  ) {
    return { ok: false, storageError: true };
  }
  const state = stateFromRead(current);
  state.active = null;
  state.orphans = [
    ...state.orphans.filter(
      (orphan) => orphan.accountId !== accountId || orphan.operationId !== operationId,
    ),
    { ...current.intent, archivedAt: Date.now() },
  ];
  return (await persistState(state))
    ? { ok: true }
    : { ok: false, storageError: true };
}

/** Retire only the matching orphan after its public status proof reaches complete. */
export async function retireAccountDeletionOrphan(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  const current = await readAccountDeletionReceipt();
  if (!current.ok) return { ok: false, storageError: true };
  const state = stateFromRead(current);
  const remaining = state.orphans.filter(
    (orphan) => orphan.accountId !== accountId || orphan.operationId !== operationId,
  );
  if (remaining.length === state.orphans.length) return { ok: true };
  state.orphans = remaining;
  return (await persistState(state))
    ? { ok: true }
    : { ok: false, storageError: true };
}
