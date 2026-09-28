/**
 * Srdcovky — the pubs a user saved with the heart on the pub page.
 *
 * Private to the account and kept by geohash-8 `pubKey`, like private ratings.
 * The store keeps the name and position too, so the list in pub search and the
 * hearts on the map work offline without the pub catalog.
 *
 *   - PUSH: pubFavoritesSync subscribes to `favorites` and queues a save or a
 *     removal for every change.
 *   - PULL: restorePubFavorites() merges the server set on launch through
 *     `hydrateFavorites` (last write wins by `updatedAt`), including hearts
 *     removed on another device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PubFavorite {
  name: string;
  lat: number;
  lng: number;
  city?: string;
  externalId?: string;
  /** ISO-8601 time of the last local change, the sync's last-write-wins clock. */
  updatedAt: string;
}

export type PubFavoriteInput = Omit<PubFavorite, 'updatedAt'>;

interface PubFavoritesState {
  favorites: Record<string, PubFavorite>;
  /** Save or remove a pub; returns true when the pub is saved afterwards. */
  toggleFavorite: (pubKey: string, pub: PubFavoriteInput) => boolean;
  /**
   * Merge server favourites (the PULL side of sync). Last write wins. `removed`
   * drops local hearts removed on another device unless the local one is newer.
   */
  hydrateFavorites: (
    serverFavorites: { pubKey: string; favorite: PubFavorite }[],
    removed?: { pubKey: string; updatedAt: string }[],
  ) => void;
}

function isFavorite(value: unknown): value is PubFavorite {
  const f = value as PubFavorite;
  return (
    !!f &&
    typeof f.name === 'string' &&
    typeof f.lat === 'number' &&
    Number.isFinite(f.lat) &&
    typeof f.lng === 'number' &&
    Number.isFinite(f.lng) &&
    typeof f.updatedAt === 'string' &&
    (f.city === undefined || typeof f.city === 'string') &&
    (f.externalId === undefined || typeof f.externalId === 'string')
  );
}

/** Keep only well-formed entries from persisted storage. Exported for tests. */
export function sanitizeFavorites(persisted: unknown): Record<string, PubFavorite> {
  const raw = (persisted as { favorites?: unknown } | null)?.favorites;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, PubFavorite> = {};
  for (const [pubKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (/^[0-9b-hjkmnp-z]{8}$/.test(pubKey) && isFavorite(value)) out[pubKey] = value;
  }
  return out;
}

export const usePubFavoritesStore = create<PubFavoritesState>()(
  persist(
    (set, get) => ({
      favorites: {},

      toggleFavorite: (pubKey, pub) => {
        const current = get().favorites;
        if (current[pubKey]) {
          const next = { ...current };
          delete next[pubKey];
          set({ favorites: next });
          return false;
        }
        const favorite: PubFavorite = {
          name: pub.name,
          lat: pub.lat,
          lng: pub.lng,
          ...(pub.city ? { city: pub.city } : {}),
          ...(pub.externalId ? { externalId: pub.externalId } : {}),
          updatedAt: new Date().toISOString(),
        };
        set({ favorites: { ...current, [pubKey]: favorite } });
        return true;
      },

      hydrateFavorites: (serverFavorites, removed = []) => {
        let changed = false;
        const next = { ...get().favorites };
        for (const { pubKey, favorite } of serverFavorites) {
          const local = next[pubKey];
          if (local) {
            const localMs = Date.parse(local.updatedAt);
            const serverMs = Date.parse(favorite.updatedAt);
            if (!(Number.isFinite(serverMs) && serverMs > localMs)) continue;
          }
          next[pubKey] = favorite;
          changed = true;
        }
        // A removal wins a tie, the same as on the server.
        for (const { pubKey, updatedAt } of removed) {
          const local = next[pubKey];
          const removedMs = Date.parse(updatedAt);
          if (!local || !Number.isFinite(removedMs)) continue;
          if (Date.parse(local.updatedAt) > removedMs) continue;
          delete next[pubKey];
          changed = true;
        }
        if (changed) set({ favorites: next });
      },
    }),
    {
      name: 'na-pivo-pub-favorites',
      version: 0,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ favorites: state.favorites }),
      merge: (persisted, current) => ({ ...current, favorites: sanitizeFavorites(persisted) }),
    },
  ),
);

/** Whether a pub is saved. Stable selector for `useStore`. */
export function selectIsFavorite(pubKey: string) {
  return (state: PubFavoritesState): boolean => Boolean(state.favorites[pubKey]);
}
