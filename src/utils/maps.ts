import * as Linking from 'expo-linking';
import type { Pub } from '@/data/pubs';
import { useSettingsStore, type HomePoint, type NavigationProvider } from '@/stores/settingsStore';

type MapsLinkPub = Pick<Pub, 'lat' | 'lng'> &
  Partial<Pick<Pub, 'name' | 'googlePlaceId'>>;

/**
 * Build a Google Maps universal URL for the pub.
 *
 * When the pub carries a backend-provided `googlePlaceId`, the link targets the
 * exact business via `query_place_id`, so Google Maps opens the venue's place
 * card (name, rating, photos) instead of a bare pin. The `query` value is only
 * a human-readable fallback in that case — the place id wins.
 *
 * Without a place id we fall back to plain coordinates. The Maps URL surface
 * needs no API key and creates no Places request, and coordinates instead of a
 * venue-name query avoid sending the user to a different business with a
 * similar name in another city.
 */
export function buildMapsUrl(pub: MapsLinkPub): string {
  const coords = `${pub.lat},${pub.lng}`;
  const params = new URLSearchParams({ api: '1' });
  if (pub.googlePlaceId) {
    params.set('query', pub.name || coords);
    params.set('query_place_id', pub.googlePlaceId);
  } else {
    params.set('query', coords);
  }
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Convenience wrapper that uses expo-linking to open the URL.
 */
export async function openPubInMaps(pub: MapsLinkPub): Promise<void> {
  const url = buildNavigationUrl(
    pub,
    useSettingsStore.getState().navigationProvider,
    pub.googlePlaceId,
  );
  await Linking.openURL(url);
}

/** Builds a destination-only route URL. The navigation app determines the start point. */
export function buildNavigationUrl(
  destination: HomePoint,
  provider: NavigationProvider,
  googlePlaceId?: string,
): string {
  if (provider === 'mapy') {
    const params = new URLSearchParams({
      end: `${destination.lng},${destination.lat}`,
      routeType: 'foot_fast',
      navigate: 'true',
    });
    return `https://mapy.com/fnc/v1/route?${params.toString()}`;
  }

  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'walking',
  });
  if (googlePlaceId) params.set('destination_place_id', googlePlaceId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export async function openHomeInMaps(point: HomePoint): Promise<void> {
  const url = buildNavigationUrl(point, useSettingsStore.getState().navigationProvider);
  await Linking.openURL(url);
}
