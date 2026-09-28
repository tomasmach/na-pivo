/**
 * Two-way sync for favourite pubs, wired like pubRatingsSync.
 *
 * PUSH: `installPubFavoritesSync` diffs every store change into a queued save
 * or removal, so the heart button only touches the store.
 * PULL: `restorePubFavorites` merges the server set on launch (last write wins),
 * pushes local favourites the server lacks or has older, and flushes.
 * Hydration runs under `suppressSync` so pulled data is not echoed back.
 *
 * Known limit, same as ratings: the server keeps no record of removals, so a
 * heart removed on one phone comes back if another phone that still has it
 * pushes a newer save.
 */

import {
  enqueueFavoriteOp,
  flushPubFavoritesQueue,
  getQueuedFavoriteRemovalKeys,
} from './pubFavoritesQueue';
import { fetchFavorites, type WireFavoriteUpsert } from './pubFavoritesClient';
import { usePubFavoritesStore, type PubFavorite } from '@/stores/pubFavoritesStore';

let suppressSync = false;

/** Run local-only favourite changes (account-boundary wipes) without syncing. */
export function runWithoutPubFavoritesSync(task: () => void): void {
  const previous = suppressSync;
  suppressSync = true;
  try {
    task();
  } finally {
    suppressSync = previous;
  }
}

function savePayload(favorite: PubFavorite): WireFavoriteUpsert {
  return {
    name: favorite.name,
    lat: favorite.lat,
    lng: favorite.lng,
    external_id: favorite.externalId ?? null,
    favorite: true,
    updated_at: favorite.updatedAt,
  };
}

function enqueueSave(pubKey: string, favorite: PubFavorite): void {
  void enqueueFavoriteOp({ pubKey, payload: savePayload(favorite) });
}

function enqueueRemoval(pubKey: string, favorite: PubFavorite): void {
  void enqueueFavoriteOp({
    pubKey,
    payload: { ...savePayload(favorite), favorite: false, updated_at: new Date().toISOString() },
  });
}

/** Subscribe to the store and push every change. Installed once per process. */
export function installPubFavoritesSync(): () => void {
  let prev = usePubFavoritesStore.getState().favorites;
  return usePubFavoritesStore.subscribe((state) => {
    const next = state.favorites;
    if (next === prev) return;
    if (suppressSync) {
      prev = next;
      return;
    }
    const before = prev;
    prev = next;
    for (const [pubKey, favorite] of Object.entries(next)) {
      if (before[pubKey] !== favorite) enqueueSave(pubKey, favorite);
    }
    for (const [pubKey, favorite] of Object.entries(before)) {
      if (!(pubKey in next)) enqueueRemoval(pubKey, favorite);
    }
  });
}

/** Pull + merge the server favourites, push what the server lacks, flush. */
export async function restorePubFavorites(signal?: AbortSignal): Promise<boolean> {
  await flushPubFavoritesQueue();
  const pendingRemovals = await getQueuedFavoriteRemovalKeys();
  const server = await fetchFavorites(signal);
  if (server === null) return false;

  const serverByKey = new Map<string, PubFavorite>();
  const merged: { pubKey: string; favorite: PubFavorite }[] = [];
  for (const wire of server) {
    if (pendingRemovals.has(wire.cache_key)) continue;
    const favorite: PubFavorite = {
      name: wire.name,
      lat: wire.lat,
      lng: wire.lng,
      ...(wire.external_id ? { externalId: wire.external_id } : {}),
      updatedAt: wire.updated_at,
    };
    serverByKey.set(wire.cache_key, favorite);
    merged.push({ pubKey: wire.cache_key, favorite });
  }

  runWithoutPubFavoritesSync(() => {
    usePubFavoritesStore.getState().hydrateFavorites(merged);
  });

  for (const [pubKey, local] of Object.entries(usePubFavoritesStore.getState().favorites)) {
    if (pendingRemovals.has(pubKey)) continue;
    const remote = serverByKey.get(pubKey);
    if (!remote || Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)) {
      enqueueSave(pubKey, local);
    }
  }

  await flushPubFavoritesQueue();
  return true;
}
