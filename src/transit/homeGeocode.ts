import * as Location from 'expo-location';

import { geocodePubLocation } from '@/data/mapyClient';
import type { HomePoint } from '@/stores/settingsStore';

/** Address to a home point: the phone's geocoder first, the backend fallback without asking for location. */
export async function geocodeHomeAddress(query: string, signal: AbortSignal): Promise<HomePoint | null> {
  try {
    const [nativeResult] = await Location.geocodeAsync(query);
    if (
      !signal.aborted &&
      nativeResult &&
      Number.isFinite(nativeResult.latitude) &&
      Number.isFinite(nativeResult.longitude)
    ) {
      return { lat: nativeResult.latitude, lng: nativeResult.longitude };
    }
  } catch {
    // Android's native geocoder requires foreground location permission. Do
    // not prompt just for an address lookup; use the existing backend fallback.
  }

  if (signal.aborted) return null;
  const result = await geocodePubLocation({ name: '', address: query }, signal);
  return result ? { lat: result.lat, lng: result.lng } : null;
}
