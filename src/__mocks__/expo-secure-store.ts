/**
 * Test mock for expo-secure-store (an ESM-only native module that Jest cannot
 * load directly). Backs the secure store with a plain in-memory map so any code
 * path that reaches account.ts during a test resolves without touching the
 * device keychain. Individual tests can still jest.mock it for assertions.
 */

const store: Record<string, string> = {};

export async function getItemAsync(key: string): Promise<string | null> {
  return key in store ? store[key] : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store[key] = value;
}

export async function deleteItemAsync(key: string): Promise<void> {
  delete store[key];
}
