import * as Linking from 'expo-linking';
import type { Pub } from '@/data/pubs';

/**
 * Build a Google Maps universal URL for the pub's exact coordinates.
 *
 * The Maps URL surface needs no API key and creates no Places request. Using
 * coordinates instead of a venue-name query also avoids sending the user to a
 * different business with a similar name in another city.
 */
export function buildMapsUrl(pub: Pick<Pub, 'lat' | 'lng'>): string {
  const params = new URLSearchParams({
    api: '1',
    query: `${pub.lat},${pub.lng}`,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Convenience wrapper that uses expo-linking to open the URL.
 */
export async function openPubInMaps(
  pub: Pick<Pub, 'lat' | 'lng'>
): Promise<void> {
  const url = buildMapsUrl(pub);
  await Linking.openURL(url);
}
