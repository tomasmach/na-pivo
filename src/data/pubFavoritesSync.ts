/**
 * Two-way sync for favourite pubs, wired like pubRatingsSync.
 *
 * PUSH: `installPubFavoritesSync` diffs every store change into a queued save
 * or removal, so the heart button only touches the store.
 * PULL: `restorePubFavorites` merges the server set on launch (last write wins),
 * drops hearts removed on another device, pushes local favourites the server
 * lacks or has older, and flushes.
 * Hydration runs under `suppressSync` so pulled data is not echoed back.
 */

import {
  enqueueFavoriteOp,
  flushPubFavoritesQueue,
  getQueuedFavoriteRemovalKeys,
} from './pubFavoritesQueue';
import { fetchFavorites, type WireFavoriteUpsert } from './pubFavoritesClient';
import { usePubFavoritesStore, type PubFavorite } from '@/stores/pubFavoritesStore';

let suppressSync = false;
/** Bumped by every account-boundary wipe; a pull that straddles one is dropped. */
let boundaryGeneration = 0;
/** Hearts removed on this phone while a pull is in flight. */
const removedDuringPull = new Set<string>();
let pullsInFlight = 0;

/**
 * Wipe this device's favourites at an account boundary (logout, deletion,
 * reset sign-in) without syncing the wipe, and void any pull already under way
 * so the outgoing account's hearts never land under the next one.
 */
export function clearLocalPubFavorites(): void {
  boundaryGeneration += 1;
  runWithoutPubFavoritesSync(() => {
    usePubFavoritesStore.setState({ favorites: {} });
  });
}

/** Run local-only favourite changes without syncing them. */
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
      if (pubKey in next) continue;
      if (pullsInFlight > 0) removedDuringPull.add(pubKey);
      enqueueRemoval(pubKey, favorite);
    }
  });
}

/** Pull + merge the server favourites, push what the server lacks, flush. */
export async function restorePubFavorites(signal?: AbortSignal): Promise<boolean> {
  pullsInFlight += 1;
  try {
    return await restoreOnce(signal);
  } finally {
    pullsInFlight -= 1;
    if (pullsInFlight === 0) removedDuringPull.clear();
  }
}

async function restoreOnce(signal?: AbortSignal): Promise<boolean> {
  const generation = boundaryGeneration;
  await flushPubFavoritesQueue();
  const server = await fetchFavorites(signal);
  if (server === null) return false;
  // The account changed while we waited: this answer belongs to someone else.
  if (generation !== boundaryGeneration) return false;
  // Read removals after the pull too, so a heart taken off meanwhile stays off.
  const pendingRemovals = await getQueuedFavoriteRemovalKeys();
  for (const pubKey of removedDuringPull) pendingRemovals.add(pubKey);
  if (generation !== boundaryGeneration) return false;

  const serverByKey = new Map<string, PubFavorite>();
  const merged: { pubKey: string; favorite: PubFavorite }[] = [];
  for (const wire of server.favorites) {
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

  const removed = server.removed
    .filter((wire) => !pendingRemovals.has(wire.cache_key))
    .map((wire) => ({ pubKey: wire.cache_key, updatedAt: wire.updated_at }));

  // A heart removed on another device leaves this one too, so it is not
  // pushed back below.
  runWithoutPubFavoritesSync(() => {
    usePubFavoritesStore.getState().hydrateFavorites(merged, removed);
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
