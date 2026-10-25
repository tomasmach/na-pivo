import type { WireDrink } from '@/data/drinksClient';
import type { Pub } from '@/data/pubs';
import { normalizeDrinkType } from '@/drinks/drinkTypes';
import type { PubFavorite } from '@/stores/pubFavoritesStore';
import type { TallySession } from '@/stores/tallyStore';

const MIN_FAVORITE_BEER_COUNT = 3;

/**
 * The beer logged most often, or null until one has been logged a few times.
 * Remote drinks come from the account snapshot; a local drink with the same id
 * is already among them. A tie goes to the beer drunk most recently.
 */
export function favoriteBeerName(
  remoteDrinks: WireDrink[] | null,
  sessions: TallySession[],
): string | null {
  const tally = new Map<string, { name: string; count: number; lastAt: number }>();
  const add = (rawName: string, at: string) => {
    const name = rawName.trim();
    const key = name.toLocaleLowerCase();
    if (!key) return;
    const atMs = Date.parse(at) || 0;
    const entry = tally.get(key);
    if (!entry) {
      tally.set(key, { name, count: 1, lastAt: atMs });
      return;
    }
    entry.count += 1;
    if (atMs >= entry.lastAt) {
      entry.lastAt = atMs;
      entry.name = name;
    }
  };

  const remoteIds = new Set<string>();
  for (const drink of remoteDrinks ?? []) {
    remoteIds.add(drink.client_id);
    if (drink.is_suspect || normalizeDrinkType(drink.drink_type) !== 'beer') continue;
    add(drink.beer.name, drink.drank_at);
  }
  for (const session of sessions) {
    for (const drink of session.drinks) {
      if (remoteIds.has(drink.id) || normalizeDrinkType(drink.drinkType) !== 'beer') continue;
      add(drink.beerName, drink.at);
    }
  }

  let best: { name: string; count: number; lastAt: number } | null = null;
  for (const entry of tally.values()) {
    if (!best || entry.count > best.count || (entry.count === best.count && entry.lastAt > best.lastAt)) {
      best = entry;
    }
  }
  return best && best.count >= MIN_FAVORITE_BEER_COUNT ? best.name : null;
}

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
