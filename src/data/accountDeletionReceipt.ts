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
export const ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY =
  'na-pivo-account-deletion-intent-quarantine-v1';

export interface AccountDeletionIntent {
  accountId: string;
  operationId: string;
  phase: 'pending' | 'complete';
  credentialBindingId?: string;
}

export interface AccountDeletionOrphan extends AccountDeletionIntent {
  archivedAt: number;
}

interface StoredAccountDeletionState {
  version: 3 | 4;
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
  | { ok: false; storageError: true; failureKind: 'io' | 'unsupported' }
  | {
      ok: false;
      storageError: false;
      failureKind: 'corrupt';
      quarantineId: string;
    };

export type AccountDeletionReceiptWriteResult =
  | { ok: true }
  | { ok: false; storageError: true };

// Canonical (lowercase) RFC 4122 UUID v4: version nibble must be 4 and the
// variant nibble one of 8/9/a/b. This is THE single pattern for every durable
// identifier in this protocol — both credential binding IDs and operation IDs.
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A present-but-malformed binding in durable state fails closed; a MISSING
// binding stays legal only because legacy v2/v3 receipts migrate without one.
function hasValidOptionalCredentialBinding(value: unknown): boolean {
  if (value === undefined) return true;
  return typeof value === 'string' && CANONICAL_UUID_V4_PATTERN.test(value);
}

function isIntent(value: unknown): value is AccountDeletionIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const intent = value as Partial<AccountDeletionIntent> & {
    credentialBindingId?: unknown;
  };
  return (
    typeof intent.accountId === 'string' &&
    intent.accountId.length > 0 &&
    typeof intent.operationId === 'string' &&
    CANONICAL_UUID_V4_PATTERN.test(intent.operationId) &&
    (intent.phase === 'pending' || intent.phase === 'complete') &&
    hasValidOptionalCredentialBinding(intent.credentialBindingId)
  );
}

function isStrictlyBound(value: AccountDeletionIntent): boolean {
  return (
    typeof value.credentialBindingId === 'string' &&
    CANONICAL_UUID_V4_PATTERN.test(value.credentialBindingId)
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
    const state = value as {
      version?: unknown;
      active?: unknown;
      orphans?: unknown;
    };
    if (
      (state.version !== 3 && state.version !== 4) ||
      !(state.active === null || isIntent(state.active)) ||
      !Array.isArray(state.orphans)
    ) {
      return null;
    }
    const active: AccountDeletionIntent | null = state.active
      ? { ...(state.active as AccountDeletionIntent) }
      : null;
    const orphanKeys = new Set<string>();
    const orphans: AccountDeletionOrphan[] = [];
    for (const candidate of state.orphans as unknown[]) {
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
      active &&
      orphanKeys.has(`${active.accountId}\u0000${active.operationId}`)
    ) {
      return null;
    }
    if (state.version === 4) {
      const everyBound =
        (active === null || isStrictlyBound(active)) &&
        orphans.every(isStrictlyBound);
      if (!everyBound) return null;
    }
    return {
      version: state.version,
      active,
      orphans,
    };
  } catch {
    return null;
  }
}

// FNV-1a over UTF-16 code units; stable across restarts and platforms, so a
// quarantined raw always maps to the same deterministic id.
function stableHash32(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function quarantineIdForRaw(raw: string): string {
  const primary = stableHash32(raw, 0x811c9dc5);
  const collisionSuffix = stableHash32(raw, 0x1b873593);
  return `qd-${primary}-${raw.length}-${collisionSuffix}`;
}

interface QuarantineLedgerEntry {
  id: string;
  raw: string;
}

/** Bounded-shape validation; optional extra metadata keys are tolerated. */
function parseQuarantineLedger(serialized: string): QuarantineLedgerEntry[] | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value)) return null;
    const entries: QuarantineLedgerEntry[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const entry = item as { id?: unknown; raw?: unknown };
      if (
        typeof entry.id !== 'string' ||
        entry.id.length === 0 ||
        typeof entry.raw !== 'string'
      ) {
        return null;
      }
      entries.push({ id: entry.id, raw: entry.raw });
    }
    const seenIds = new Set<string>();
    for (const entry of entries) {
      if (seenIds.has(entry.id)) return null;
      seenIds.add(entry.id);
    }
    return entries;
  } catch {
    return null;
  }
}

/**
 * Copy unsalvageable raw verbatim into the durable quarantine ledger. The
 * ledger never auto-deletes or caps: entries are the only surviving copy of
 * bytes we could not parse.
 */
async function quarantineRaw(
  raw: string,
): Promise<{ ok: true; id: string } | { ok: false }> {
  let ledger: QuarantineLedgerEntry[];
  try {
    const existingRaw = await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY);
    if (existingRaw === null) {
      ledger = [];
    } else {
      const parsed = parseQuarantineLedger(existingRaw);
      if (!parsed) return { ok: false };
      ledger = parsed;
    }
  } catch {
    return { ok: false };
  }
  const exactMatch = ledger.find((entry) => entry.raw === raw);
  if (exactMatch) return { ok: true, id: exactMatch.id };
  const baseId = quarantineIdForRaw(raw);
  let id = baseId;
  if (ledger.some((entry) => entry.id === baseId)) {
    const usedIds = new Set(ledger.map((entry) => entry.id));
    let suffix = 1;
    while (usedIds.has(`${baseId}-${suffix}`)) suffix += 1;
    id = `${baseId}-${suffix}`;
  }
  const serialized = JSON.stringify([...ledger, { id, raw }]);
  try {
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY, serialized);
    if ((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY)) !== serialized) {
      return { ok: false };
    }
  } catch {
    return { ok: false };
  }
  return { ok: true, id };
}

type RawClassification =
  | { kind: 'healthy'; state: StoredAccountDeletionState }
  | { kind: 'unsupported' }
  | { kind: 'salvageable'; active: AccountDeletionIntent }
  | { kind: 'corrupt' };

/**
 * A salvage candidate is only ever a current v3/v4 container whose active slot
 * itself is fully strict-bound healthy; everything else about the container may
 * be broken and gets rebuilt from the active alone.
 */
function salvageableActive(value: object): AccountDeletionIntent | null {
  const candidate = (value as { active?: unknown }).active;
  // isIntent already enforces the canonical operation-id pattern, so the
  // strict binding proof below is the only extra check needed here.
  if (!isIntent(candidate) || !isStrictlyBound(candidate)) return null;
  return { ...candidate };
}

function classifyRaw(raw: string): RawClassification {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'corrupt' };
  }
  const version = (value as { version?: unknown }).version;
  if (typeof version === 'number' && Number.isFinite(version) && version > 4) {
    return { kind: 'unsupported' };
  }
  const state = parseState(raw);
  if (state) return { kind: 'healthy', state };
  if (version === 3 || version === 4) {
    const active = salvageableActive(value);
    if (active) return { kind: 'salvageable', active };
  }
  return { kind: 'corrupt' };
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

// Module-local FIFO mutex serializing every receipt storage critical section
// (read-modify-write cycles and quarantine ledger updates). Only AsyncStorage
// work happens under it; callers are queued in call order and the lock is
// always released in `finally`, so one failing operation never blocks later
// ones.
let receiptQueueTail: Promise<unknown> = Promise.resolve();

function withReceiptLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = receiptQueueTail;
  let release: () => void = () => {};
  receiptQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return (async () => {
    try {
      await previous;
      return await operation();
    } finally {
      release();
    }
  })();
}

export async function readAccountDeletionReceipt(): Promise<AccountDeletionReceiptReadResult> {
  return withReceiptLock(readReceiptStateLocked);
}

async function readReceiptStateLocked(): Promise<AccountDeletionReceiptReadResult> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY);
  } catch {
    return { ok: false, storageError: true, failureKind: 'io' };
  }
  if (raw === null) return { ok: true, intent: null, orphans: [] };
  const classified = classifyRaw(raw);
  if (classified.kind === 'healthy') {
    const state = classified.state;
    return {
      ok: true,
      intent: state.active ? { ...state.active } : null,
      orphans: state.orphans.map((orphan) => ({ ...orphan })),
    };
  }
  if (classified.kind === 'unsupported') {
    return { ok: false, storageError: true, failureKind: 'unsupported' };
  }
  const quarantined = await quarantineRaw(raw);
  if (!quarantined.ok) return { ok: false, storageError: true, failureKind: 'io' };
  if (classified.kind === 'corrupt') {
    return {
      ok: false,
      storageError: false,
      failureKind: 'corrupt',
      quarantineId: quarantined.id,
    };
  }
  const active = classified.active;
  const normalized = JSON.stringify({ version: 4, active: { ...active }, orphans: [] });
  try {
    await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, normalized);
    if ((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) !== normalized) {
      throw new Error('normalized readback mismatch');
    }
    return { ok: true, intent: { ...active }, orphans: [] };
  } catch {
    try {
      await AsyncStorage.setItem(ACCOUNT_DELETION_RECEIPT_KEY, raw);
      if ((await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) !== raw) {
        throw new Error('restore readback mismatch');
      }
    } catch {
      // Best-effort restore only; the quarantine copy already holds the raw.
    }
    return { ok: false, storageError: true, failureKind: 'io' };
  }
}

function stateFromRead(
  read: Extract<AccountDeletionReceiptReadResult, { ok: true }>,
): StoredAccountDeletionState {
  const active = read.intent ? { ...read.intent } : null;
  const orphans = read.orphans.map((orphan) => ({ ...orphan }));
  const everyBound =
    (active === null || isStrictlyBound(active)) && orphans.every(isStrictlyBound);
  return {
    version: everyBound ? 4 : 3,
    active,
    orphans,
  };
}

/** Persist the operation before the first DELETE. Never overwrites another active intent. */
export async function writeAccountDeletionReceipt(
  accountId: string,
  operationId: string,
  credentialBindingId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  // Fail closed before taking the lock or touching storage: only canonical
  // UUID v4 operation ids and credential bindings may ever be persisted.
  // The runtime guard also covers JS callers that bypass TypeScript types.
  if (
    !accountId ||
    typeof credentialBindingId !== 'string' ||
    !CANONICAL_UUID_V4_PATTERN.test(operationId) ||
    !CANONICAL_UUID_V4_PATTERN.test(credentialBindingId)
  ) {
    return { ok: false, storageError: true };
  }
  return withReceiptLock(async () => {
    const existing = await readReceiptStateLocked();
    if (!existing.ok || existing.intent !== null) {
      return { ok: false, storageError: true };
    }
    const state = stateFromRead(existing);
    state.active = { accountId, operationId, phase: 'pending', credentialBindingId };
    return (await persistState(state))
      ? { ok: true }
      : { ok: false, storageError: true };
  });
}

/** Upgrade only the exact active operation after server 204/status proof. */
export async function completeAccountDeletionReceipt(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  return withReceiptLock(async () => {
    const existing = await readReceiptStateLocked();
    if (
      !existing.ok ||
      existing.intent?.accountId !== accountId ||
      existing.intent.operationId !== operationId
    ) {
      return { ok: false, storageError: true };
    }
    if (existing.intent.phase === 'complete') return { ok: true };
    const state = stateFromRead(existing);
    state.active = { ...existing.intent, phase: 'complete' };
    return (await persistState(state))
      ? { ok: true }
      : { ok: false, storageError: true };
  });
}

/** Remove only an exact completed active operation after the local boundary. */
export async function clearAccountDeletionReceipt(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  return withReceiptLock(async () => {
    const current = await readReceiptStateLocked();
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
  });
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
  return withReceiptLock(async () => {
    const current = await readReceiptStateLocked();
    if (!current.ok) return { ok: false, storageError: true };
    if (current.intent === null) {
      return current.orphans.some(
        (orphan) =>
          orphan.accountId === accountId && orphan.operationId === operationId,
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
        (orphan) =>
          orphan.accountId !== accountId || orphan.operationId !== operationId,
      ),
      { ...current.intent, archivedAt: Date.now() },
    ];
    return (await persistState(state))
      ? { ok: true }
      : { ok: false, storageError: true };
  });
}

/** Retire only the matching orphan after its public status proof reaches complete. */
export async function retireAccountDeletionOrphan(
  accountId: string,
  operationId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  return withReceiptLock(async () => {
    const current = await readReceiptStateLocked();
    if (!current.ok) return { ok: false, storageError: true };
    const state = stateFromRead(current);
    const remaining = state.orphans.filter(
      (orphan) =>
        orphan.accountId !== accountId || orphan.operationId !== operationId,
    );
    if (remaining.length === state.orphans.length) return { ok: true };
    state.orphans = remaining;
    return (await persistState(state))
      ? { ok: true }
      : { ok: false, storageError: true };
  });
}

/**
 * Clear the main slot only when it still holds the exact quarantined bytes.
 * The ledger entry itself is never removed: it is the last copy of raw we
 * could not parse, so retirement is idempotent and lossless.
 */
export async function retireQuarantinedAccountDeletionReceipt(
  quarantineId: string,
): Promise<AccountDeletionReceiptWriteResult> {
  if (typeof quarantineId !== 'string' || quarantineId.length === 0) {
    return { ok: false, storageError: true };
  }
  return withReceiptLock(async () => {
    let entry: QuarantineLedgerEntry | undefined;
    try {
      const serialized = await AsyncStorage.getItem(
        ACCOUNT_DELETION_RECEIPT_QUARANTINE_KEY,
      );
      if (serialized === null) return { ok: false, storageError: true };
      const ledger = parseQuarantineLedger(serialized);
      if (!ledger) return { ok: false, storageError: true };
      entry = ledger.find((candidate) => candidate.id === quarantineId);
    } catch {
      return { ok: false, storageError: true };
    }
    if (!entry) return { ok: false, storageError: true };
    let currentMain: string | null;
    try {
      currentMain = await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY);
    } catch {
      return { ok: false, storageError: true };
    }
    if (currentMain === null) return { ok: true };
    if (currentMain !== entry.raw) return { ok: false, storageError: true };
    try {
      await AsyncStorage.removeItem(ACCOUNT_DELETION_RECEIPT_KEY);
      return (await AsyncStorage.getItem(ACCOUNT_DELETION_RECEIPT_KEY)) === null
        ? { ok: true }
        : { ok: false, storageError: true };
    } catch {
      return { ok: false, storageError: true };
    }
  });
}
