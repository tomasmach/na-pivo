/**
 * The smallest durable proof that this account is sitting at a shared table.
 *
 * A full PartyEvening contains people, pub details and the whole activity log;
 * none of that belongs in a cold-start cache. The phone only needs the server
 * row id, spoken join code and host/guest role to keep offline writes attached
 * to the same table and to choose end vs leave correctly.
 *
 * The record is account-scoped and deliberately short-lived. A successful
 * `GET /party-evenings` refresh replaces or removes it; a cellar/network miss
 * may reuse it for at most 24 hours.
 */

import AsyncStorage, { privateAccountCleanupStorage } from './privateAccountStorage';

import type { PartyEvening } from './partyClient';

export const PARTY_EVENING_IDENTITY_STORAGE_KEY = 'na-pivo-party-evening-identity-v1';
export const PARTY_EVENING_IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;

export interface ConfirmedPartyEveningIdentity {
  id: string;
  joinCode: string;
  isHost: boolean;
  confirmedAt: number;
}

interface StoredPartyEveningIdentity extends ConfirmedPartyEveningIdentity {
  version: 1;
  accountId: string;
}

let storageTail: Promise<void> = Promise.resolve();
let boundaryGeneration = 0;

function queueStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageTail.catch(() => undefined).then(operation);
  storageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function isStoredIdentity(value: unknown): value is StoredPartyEveningIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<StoredPartyEveningIdentity>;
  return (
    record.version === 1 &&
    typeof record.accountId === 'string' &&
    record.accountId.length > 0 &&
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.joinCode === 'string' &&
    /^[A-Z2-9]{6}$/.test(record.joinCode) &&
    typeof record.isHost === 'boolean' &&
    typeof record.confirmedAt === 'number' &&
    Number.isFinite(record.confirmedAt)
  );
}

async function removeStoredIdentity(strictCleanup = false): Promise<boolean> {
  const storage = strictCleanup ? privateAccountCleanupStorage : AsyncStorage;
  try {
    await storage.removeItem(PARTY_EVENING_IDENTITY_STORAGE_KEY);
    return (await storage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY)) === null;
  } catch {
    return false;
  }
}

type StoredIdentityRead =
  | { ok: true; identity: StoredPartyEveningIdentity | null }
  | { ok: false };

async function readStoredIdentity(): Promise<StoredIdentityRead> {
  try {
    const raw = await AsyncStorage.getItem(PARTY_EVENING_IDENTITY_STORAGE_KEY);
    if (!raw) return { ok: true, identity: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return (await removeStoredIdentity())
        ? { ok: true, identity: null }
        : { ok: false };
    }
    if (isStoredIdentity(parsed)) return { ok: true, identity: parsed };
    return (await removeStoredIdentity())
      ? { ok: true, identity: null }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Capture this before a request so an account reset can suppress its late write. */
export function partyEveningIdentityGeneration(): number {
  return boundaryGeneration;
}

export async function loadPartyEveningIdentity(
  accountId: string,
  now: number = Date.now(),
): Promise<ConfirmedPartyEveningIdentity | null> {
  const generation = boundaryGeneration;
  return queueStorage(async () => {
    if (generation !== boundaryGeneration) return null;
    const read = await readStoredIdentity();
    const stored = read.ok ? read.identity : null;
    if (generation !== boundaryGeneration || !stored) {
      return null;
    }
    if (stored.accountId !== accountId) {
      // A session boundary should have removed this already. Fail closed if a
      // previous process died midway through the switch: never retain another
      // account's table code on the device under the new session.
      await removeStoredIdentity();
      return null;
    }
    if (
      stored.confirmedAt > now + 5 * 60_000 ||
      now - stored.confirmedAt > PARTY_EVENING_IDENTITY_TTL_MS
    ) {
      await removeStoredIdentity();
      return null;
    }
    const { id, joinCode, isHost, confirmedAt } = stored;
    return { id, joinCode, isHost, confirmedAt };
  });
}

export async function savePartyEveningIdentity(
  accountId: string,
  evening: Pick<PartyEvening, 'id' | 'joinCode' | 'isHost'>,
  generation: number = boundaryGeneration,
  now: number = Date.now(),
): Promise<ConfirmedPartyEveningIdentity | null> {
  const joinCode = evening.joinCode.toUpperCase();
  if (!accountId || !evening.id || !/^[A-Z2-9]{6}$/.test(joinCode)) return null;
  const identity: ConfirmedPartyEveningIdentity = {
    id: evening.id,
    joinCode,
    isHost: evening.isHost,
    confirmedAt: now,
  };
  return queueStorage(async () => {
    if (generation !== boundaryGeneration) return null;
    try {
      const stored: StoredPartyEveningIdentity = {
        version: 1,
        accountId,
        ...identity,
      };
      await AsyncStorage.setItem(
        PARTY_EVENING_IDENTITY_STORAGE_KEY,
        JSON.stringify(stored),
      );
      if (generation !== boundaryGeneration) {
        await removeStoredIdentity();
        return null;
      }
      return identity;
    } catch {
      return null;
    }
  });
}

/** Remove a confirmed-none/end/leave only when it belongs to this account. */
export function clearPartyEveningIdentityForAccount(accountId: string): Promise<boolean> {
  return queueStorage(async () => {
    const read = await readStoredIdentity();
    if (!read.ok) return false;
    const stored = read.identity;
    if (!stored || stored.accountId !== accountId) return true;
    return removeStoredIdentity();
  });
}

/** End/leave queues know the table code even when their original process died. */
export function clearPartyEveningIdentityForCode(code: string): Promise<boolean> {
  const normalized = code.toUpperCase();
  return queueStorage(async () => {
    const read = await readStoredIdentity();
    if (!read.ok) return false;
    const stored = read.identity;
    if (!stored || stored.joinCode !== normalized) return true;
    return removeStoredIdentity();
  });
}

/** Account-boundary wipe; late saves captured before this call are suppressed. */
export function clearPartyEveningIdentityCache(): Promise<boolean> {
  boundaryGeneration += 1;
  return queueStorage(async () => {
    return removeStoredIdentity(true);
  });
}
