/** AsyncStorage adapter that refuses private Zustand persistence while frozen. */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { runPrivateAccountMutation } from './privateAccountBoundary';

let memoryResetDepth = 0;

/** Suppress the exact derived persist writes caused by final in-memory clear. */
export function suppressPrivatePersistenceDuringMemoryReset<T>(action: () => T): T {
  memoryResetDepth += 1;
  try {
    return action();
  } finally {
    memoryResetDepth = Math.max(0, memoryResetDepth - 1);
  }
}

interface HydrationPermit {
  storageKey: string;
  failed: boolean;
  readConsumed: boolean;
  migrationWriteConsumed: boolean;
}

let activeHydrationPermit: HydrationPermit | null = null;

/**
 * Rehydrate exactly one persisted store behind a keyed hydration permit.
 *
 * The permit is scoped to a single storage key and stays active until the
 * awaited rehydrate finishes: the storage adapter's getItem consumes the
 * single authorized read inline, and any subsequent setItem for the same
 * exact key consumes the single authorized migration write-back. Failures of
 * the underlying AsyncStorage calls are recorded on the permit so the caller
 * can fail closed even though Zustand persist swallows hydration errors.
 * Removals are never authorized, and unrelated reads/writes stay frozen.
 */
export async function runAuthorizedPrivateStoreRehydration(
  storageKey: string,
  rehydrate: () => unknown,
  hasHydrated: () => boolean,
): Promise<boolean> {
  const permit: HydrationPermit = {
    storageKey,
    failed: false,
    readConsumed: false,
    migrationWriteConsumed: false,
  };
  let pending: Promise<unknown>;
  activeHydrationPermit = permit;
  try {
    try {
      pending = Promise.resolve(rehydrate());
    } catch {
      return false;
    }
    try {
      await pending;
    } catch {
      return false;
    }
    let hydrated: boolean;
    try {
      hydrated = hasHydrated() === true && !permit.failed;
    } catch {
      return false;
    }
    return hydrated;
  } finally {
    if (activeHydrationPermit === permit) {
      activeHydrationPermit = null;
    }
  }
}

const privateAccountStorage: typeof AsyncStorage = {
  ...AsyncStorage,
  getItem: (name: string) => {
    const permit = activeHydrationPermit;
    if (permit && permit.storageKey === name && !permit.readConsumed) {
      permit.readConsumed = true;
      const pending = AsyncStorage.getItem(name);
      void pending.catch(() => {
        permit.failed = true;
      });
      return pending;
    }
    return runPrivateAccountMutation(async () => AsyncStorage.getItem(name));
  },
  setItem: (name: string, value: string) => {
    const permit = activeHydrationPermit;
    if (
      permit &&
      permit.storageKey === name &&
      permit.readConsumed &&
      !permit.migrationWriteConsumed
    ) {
      permit.migrationWriteConsumed = true;
      return AsyncStorage.setItem(name, value).catch((error: unknown) => {
        permit.failed = true;
        throw error;
      });
    }
    return memoryResetDepth > 0
      ? Promise.resolve()
      : runPrivateAccountMutation(async () => {
          await AsyncStorage.setItem(name, value);
        });
  },
  removeItem: (name: string) =>
    runPrivateAccountMutation(async () => {
      await AsyncStorage.removeItem(name);
    }),
};

/** Only strict, drained account-boundary cleanup may use this raw adapter. */
export const privateAccountCleanupStorage = AsyncStorage;
export default privateAccountStorage;
