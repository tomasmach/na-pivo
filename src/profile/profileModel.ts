
import type { Pub } from '@/data/pubs';
import type { PubFavorite } from '@/stores/pubFavoritesStore';

/** Saved pubs, newest heart first, without the pubs the user reported. */
export function savedFavoritePubs(
  favorites: Record<string, PubFavorite>,
  reportedKeys: string[],
  reportedIds: string[],
): Pub[] {
  return Object.entries(favorites)
    .filter(([key, favorite]) => !reportedKeys.includes(key)
      && !(favorite.externalId && reportedIds.includes(favorite.externalId)))
    .sort(([, a], [, b]) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map(([, favorite]) => ({
      // The pub page treats an empty id as "find it by its cell".
      id: favorite.externalId ?? '',
      name: favorite.name,
      lat: favorite.lat,
      lng: favorite.lng,
      ...(favorite.city ? { city: favorite.city } : {}),
    }));
}
