import * as Linking from 'expo-linking';
import type { Pub } from '@/data/pubs';

/**
 * Builds a Mapy.cz URL that opens the pub by name, centred on its location. On
 * mobile this hands off to the Mapy.cz / Mapy.com app via universal links if
 * installed, else the web.
 *
 * The Mapy.cz suggest API gives us no place ID, so we cannot deep-link to a POI
 * detail card directly. Instead we run a name search (`q`) anchored at the pub's
 * coordinates: the name comes straight from Mapy.cz, so the search resolves to
 * the same POI and shows its label — unlike a bare coordinate pin.
 *
 * Note: Mapy.cz uses x=longitude and y=latitude (the opposite of Google's
 * lat,lng order).
 */
export function buildMapsUrl(pub: Pick<Pub, 'name' | 'lat' | 'lng'>): string {
  const query = encodeURIComponent(pub.name);
  return `https://mapy.cz/zakladni?q=${query}&x=${pub.lng}&y=${pub.lat}&z=17`;
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
