import AsyncStorage from '@react-native-async-storage/async-storage';

// Keep both released keys: an upgrade can interrupt any stage of a 2.0 claim.
const MERGE_KEY = 'na-pivo-party-games-account-merge';
const LEGACY_MERGE_KEY = 'na-pivo-private-account-merge-v0';

export interface AccountMergeIntent {
  version: 1;
  operationId: string;
  fromAccountId: string;
  toAccountId: string | null;
  preparedAt: number;
}

function parseIntent(raw: string): AccountMergeIntent {
  const value = JSON.parse(raw) as AccountMergeIntent;
  if (
    !value || value.version !== 1 ||
    typeof value.operationId !== 'string' || !value.operationId ||
    typeof value.fromAccountId !== 'string' || !value.fromAccountId ||
    !(value.toAccountId === null || (typeof value.toAccountId === 'string' && value.toAccountId)) ||
    typeof value.preparedAt !== 'number' || !Number.isFinite(value.preparedAt)
  ) throw new Error('Invalid account merge intent.');
  return value;
}

export async function readAccountMerge(): Promise<
  { ok: true; intent: AccountMergeIntent | null } | { ok: false }
> {
  try {
    const current = await AsyncStorage.getItem(MERGE_KEY);
    const legacy = await AsyncStorage.getItem(LEGACY_MERGE_KEY);
    const intent = current !== null ? parseIntent(current) : null;
    const oldIntent = legacy !== null ? parseIntent(legacy) : null;
    if (intent && oldIntent && (
      intent.operationId !== oldIntent.operationId ||
      intent.fromAccountId !== oldIntent.fromAccountId ||
      (oldIntent.toAccountId !== null && intent.toAccountId !== oldIntent.toAccountId)
    )) return { ok: false };
    return { ok: true, intent: intent ?? oldIntent };
  } catch {
    // Unreadable storage is not proof that no claim is in flight.
    return { ok: false };
  }
}

export async function hasPendingAccountMerge(): Promise<boolean> {
  const loaded = await readAccountMerge();
  return !loaded.ok || loaded.intent !== null;
}

async function saveIntent(intent: AccountMergeIntent): Promise<void> {
  const raw = JSON.stringify(intent);
  await AsyncStorage.setItem(MERGE_KEY, raw);
  if (await AsyncStorage.getItem(MERGE_KEY) !== raw) {
    throw new Error('Account merge intent was not persisted.');
  }
}

/** Caller holds the session-cache lock, so a concurrent 401 cannot evict A. */
export async function prepareAccountMerge(fromAccountId: string, operationId: string): Promise<{
  intent: AccountMergeIntent;
  cancelSafe: boolean;
}> {
  const loaded = await readAccountMerge();
  if (!loaded.ok) throw new Error('Account merge storage is unavailable.');
  if (loaded.intent) {
    if (loaded.intent.fromAccountId !== fromAccountId) {
      throw new Error('Account merge belongs to another session.');
    }
    return { intent: loaded.intent, cancelSafe: false };
  }
  const intent: AccountMergeIntent = {
    version: 1, operationId, fromAccountId, toAccountId: null, preparedAt: Date.now(),
  };
  await saveIntent(intent);
  return { intent, cancelSafe: true };
}

/** Bind the proved target durably before replacing the source bearer. */
export async function bindAccountMerge(targetAccountId: string): Promise<void> {
  const loaded = await readAccountMerge();
  if (!loaded.ok) throw new Error('Account merge storage is unavailable.');
  if (!loaded.intent) return;
  if (loaded.intent.toAccountId !== null && loaded.intent.toAccountId !== targetAccountId) {
    throw new Error('Account merge target does not match.');
  }
  await saveIntent({ ...loaded.intent, toAccountId: targetAccountId });
}

/** Only an acknowledged target or a newly rejected operation may remove proof. */
export async function clearAccountMerge(expected: { targetAccountId: string } | { operationId: string }): Promise<void> {
  const loaded = await readAccountMerge();
  if (!loaded.ok) throw new Error('Account merge storage is unavailable.');
  if (!loaded.intent) return;
  const matches = 'targetAccountId' in expected
    ? loaded.intent.toAccountId === expected.targetAccountId
    : loaded.intent.operationId === expected.operationId && loaded.intent.toAccountId === null;
  if (!matches) throw new Error('Account merge acknowledgement does not match.');
  // Keep the current marker if deleting the legacy copy fails.
  await AsyncStorage.removeItem(LEGACY_MERGE_KEY);
  if (await AsyncStorage.getItem(LEGACY_MERGE_KEY) !== null) throw new Error('Account merge cleanup failed.');
  await AsyncStorage.removeItem(MERGE_KEY);
  if (await AsyncStorage.getItem(MERGE_KEY) !== null) throw new Error('Account merge cleanup failed.');
}
