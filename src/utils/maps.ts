import * as Linking from 'expo-linking';
import type { Pub } from '@/data/pubs';

/**
 * Builds a Google Maps URL that opens the pub. On iOS, this hands off to the
 * Google Maps app if installed, else Safari → maps.google.com.
 */
export function buildMapsUrl(pub: Pick<Pub, 'name' | 'lat' | 'lng'>): string {
  const encodedName = encodeURIComponent(pub.name);
  return `https://www.google.com/maps/search/?api=1&query=${pub.lat},${pub.lng}(${encodedName})`;
}

/**
 * Convenience wrapper that uses expo-linking to open the URL.
 */
export async function openPubInMaps(
  pub: Pick<Pub, 'name' | 'lat' | 'lng'>
): Promise<void> {
  const url = buildMapsUrl(pub);
  await Linking.openURL(url);
}
