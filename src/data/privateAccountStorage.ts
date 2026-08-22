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

const privateAccountStorage: typeof AsyncStorage = {
  ...AsyncStorage,
  getItem: (name: string) =>
    runPrivateAccountMutation(async () => AsyncStorage.getItem(name)),
  setItem: (name: string, value: string) =>
    memoryResetDepth > 0
      ? Promise.resolve()
      : runPrivateAccountMutation(async () => {
          await AsyncStorage.setItem(name, value);
        }),
  removeItem: (name: string) =>
    runPrivateAccountMutation(async () => {
      await AsyncStorage.removeItem(name);
    }),
};

/** Only strict, drained account-boundary cleanup may use this raw adapter. */
export const privateAccountCleanupStorage = AsyncStorage;
export default privateAccountStorage;
