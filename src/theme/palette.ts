/**
 * Which ground the app is painted on. Gray is the maintained look; brown is
 * the earlier palette, kept unmaintained for people who miss it. Like the UI language, the
 * choice is read synchronously at launch, before any StyleSheet is created,
 * so switching persists it and restarts the JS bundle.
 */

import * as SecureStore from 'expo-secure-store';

export type Palette = 'gray' | 'brown';

export const PALETTES: readonly Palette[] = ['gray', 'brown'];
export const DEFAULT_PALETTE: Palette = 'gray';

const STORAGE_KEY = 'na-pivo-palette';
const STORE_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

/** Pure resolver so tests can drive it without storage. */
export function resolvePalette(stored: unknown): Palette {
  return stored === 'brown' ? 'brown' : DEFAULT_PALETTE;
}

export function readStoredPalette(): Palette {
  try {
    return resolvePalette(SecureStore.getItem(STORAGE_KEY, STORE_OPTIONS));
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function writeStoredPalette(next: Palette): void {
  SecureStore.setItem(STORAGE_KEY, next, STORE_OPTIONS);
}

export const palette: Palette = readStoredPalette();
