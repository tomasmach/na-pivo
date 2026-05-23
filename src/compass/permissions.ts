/**
 * Location permission helpers.
 */

import * as Location from 'expo-location';
import { Linking } from 'react-native';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * Checks the current foreground location permission.
 * If undetermined, asks the user. Returns the resulting state.
 */
export async function ensureLocationPermission(): Promise<PermissionState> {
  const { status } = await Location.getForegroundPermissionsAsync();

  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';

  // undetermined → ask
  const { status: requested } = await Location.requestForegroundPermissionsAsync();
  if (requested === 'granted') return 'granted';
  if (requested === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Opens the iOS/Android system settings so the user can change permissions.
 */
export async function openSystemSettings(): Promise<void> {
  await Linking.openSettings();
}
