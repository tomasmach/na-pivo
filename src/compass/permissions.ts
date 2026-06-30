/**
 * Location permission helpers.
 */

import * as Location from 'expo-location';
import { Linking } from 'react-native';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * Checks the current foreground location permission without prompting.
 */
export async function checkLocationPermission(): Promise<PermissionState> {
  const { status } = await Location.getForegroundPermissionsAsync();

  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Requests foreground location permission. Call only from a user action.
 */
export async function requestLocationPermission(): Promise<PermissionState> {
  const { status: requested } = await Location.requestForegroundPermissionsAsync();
  if (requested === 'granted') return 'granted';
  if (requested === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Ensures foreground location permission by checking first, then prompting only
 * when still undetermined. Keep this for explicit CTA flows.
 */
export async function ensureLocationPermission(): Promise<PermissionState> {
  const current = await checkLocationPermission();
  if (current !== 'undetermined') return current;
  return requestLocationPermission();
}

/**
 * Opens the iOS/Android system settings so the user can change permissions.
 */
export async function openSystemSettings(): Promise<void> {
  await Linking.openSettings();
}
