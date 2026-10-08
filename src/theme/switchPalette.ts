/**
 * Switch between the gray and the brown palette. Colors are bound once at
 * launch (see colors.ts), so the switch persists the choice, swaps the app
 * icon to match and restarts the JS bundle.
 */

import { DevSettings, Platform } from 'react-native';
import * as Updates from 'expo-updates';

import { palette, writeStoredPalette, type Palette } from './palette';

/** Name of the brown alternate icon registered in app.config.ts. */
const BROWN_ICON = 'Brown';

async function setAppIcon(next: Palette): Promise<void> {
  // Android swaps icons by disabling MainActivity for an alias that lacks the
  // napivo:// filter, which would break notification and widget links.
  if (Platform.OS !== 'ios') return;
  try {
    // Lazy require: builds made before the icon module existed still get the
    // new colors from an update; only the icon stays as it was.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const icons = require('expo-alternate-app-icons') as typeof import('expo-alternate-app-icons');
    if (!icons.supportsAlternateIcons) return;
    await icons.setAlternateAppIcon(next === 'brown' ? BROWN_ICON : null);
  } catch {
    // The palette still switches; the icon is a nice-to-have.
  }
}

/** Returns false when the choice could not be stored; the caller shows an error. */
export async function switchPalette(next: Palette): Promise<boolean> {
  if (next === palette) return true;
  try {
    writeStoredPalette(next);
  } catch {
    return false;
  }
  await setAppIcon(next);
  try {
    await Updates.reloadAsync();
  } catch {
    // Development builds without expo-updates fall back to the dev reload.
    DevSettings.reload();
  }
  return true;
}
