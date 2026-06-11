import * as Linking from 'expo-linking';
import type { Pub } from '@/data/pubs';

/**
 * Builds a Mapy.com URL that pins the pub at its exact coordinates. On mobile
 * this hands off to the Mapy.cz / Mapy.com app via universal links if installed,
 * else the web.
 *
 * We use the documented showmap URL API with coordinates only — never a name
 * search. The Mapy.cz suggest API gives us no place ID, so we cannot deep-link
 * to a POI detail card; and a name search (`q`) is resolved nationwide by
 * textual relevance, so it can land on a different place with a similar name far
 * away (e.g. "Restaurace Kamenec" near Olomouc resolving to "Pohostinství
 * Kamenec u Poličky" ~150 km away). showmap pins the precise position and does
 * no searching.
 *
 * Note: showmap's `center` is longitude-first (lon,lat), the opposite of
 * Google's lat,lng order. The comma is encoded as %2C, which Mapy.com accepts.
 */
export function buildMapsUrl(pub: Pick<Pub, 'lat' | 'lng'>): string {
  const params = new URLSearchParams({
    center: `${pub.lng},${pub.lat}`,
    zoom: '17',
    marker: 'true',
  });
  return `https://mapy.com/fnc/v1/showmap?${params.toString()}`;
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
