/**
 * Beer photo diary — the local source of truth for the user's own photos.
 *
 * Holds BOTH server-synced photos and locally-pending ones (queued uploads that
 * have not reached the backend yet), so the diary renders instantly and
 * offline. The store is persisted to AsyncStorage so pending photos survive an
 * app restart; the durable JPEG itself lives in
 * <documentDirectory>/beer-photos/<clientId>.jpg (see beerPhotosQueue).
 *
 * Sync-state lifecycle of one entry:
 *   pending (addPendingPhoto, localUri set)
 *     → synced (markSynced: server photo replaces it, localUri dropped —
 *               the queue deletes the local file AFTER this store update)
 *     → failed (markFailed: upload permanently rejected; localUri kept so the
 *               user can retry or at least still see the photo)
 *
 * Merge rule (setServerPhotos): the server list wins for everything it knows
 * about; local entries that are still pending/failed and unknown to the server
 * are kept on top. Ordering is newest-first by takenAt (createdAt fallback).
 *
 * Delivery to the backend lives entirely outside this store (beerPhotosQueue);
 * this module never talks to the network except via loadBeerPhotos().
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchMyBeerPhotos,
  type BeerPhoto,
  type BeerPhotoVisibility,
} from '@/data/beerPhotosClient';

export type BeerPhotoSyncState = 'pending' | 'synced' | 'failed';

/** A diary photo as the UI sees it — a BeerPhoto plus local delivery state. */
export interface BeerPhotoLocal {
  /** Server id once synced; null while only local. */
  id: string | null;
  /** The idempotency key — stable across retries and restarts. */
  clientId: string;
  /** Absolute remote URL once synced; null while only local (render localUri). */
  imageUrl: string | null;
  caption: string;
  pubCacheKey: string;
  pubName: string;
  pubCity: string;
  visibility: BeerPhotoVisibility;
  takenAt: string;
  createdAt: string;
  inContest: boolean;
  /** Durable local file uri while the upload is pending/failed. */
  localUri?: string;
  syncState: BeerPhotoSyncState;
  /**
   * Why the upload permanently failed (backend code off POST /v1/beer-photos:
   * 'photo_limit_reached', 'photo_too_large', 'photo_invalid', or the local
   * 'queue_overflow'). Only meaningful while syncState === 'failed'; drives the
   * specific Czech error copy and hides retry for un-retryable codes.
   */
  failureCode?: string;
}

/** What addPendingPhoto needs — mirrors the queue's upload op. */
export interface PendingBeerPhotoInput {
  clientId: string;
  localUri: string;
  caption: string;
  pubCacheKey?: string;
  pubName?: string;
  pubCity?: string;
  visibility: BeerPhotoVisibility;
  takenAt: string;
}

function fromServerPhoto(photo: BeerPhoto): BeerPhotoLocal {
  return {
    id: photo.id,
    clientId: photo.clientId,
    imageUrl: photo.imageUrl,
    caption: photo.caption,
    pubCacheKey: photo.pubCacheKey,
    pubName: photo.pubName,
    pubCity: photo.pubCity,
    visibility: photo.visibility,
    takenAt: photo.takenAt,
    createdAt: photo.createdAt,
    inContest: photo.inContest,
    syncState: 'synced',
  };
}

/** Newest first — takenAt wins, createdAt breaks ties/absences. */
function sortNewestFirst(photos: BeerPhotoLocal[]): BeerPhotoLocal[] {
  return [...photos].sort((a, b) => {
    const aKey = a.takenAt || a.createdAt;
    const bKey = b.takenAt || b.createdAt;
    return bKey.localeCompare(aKey);
  });
}

interface BeerPhotosState {
  photos: BeerPhotoLocal[];
  /**
   * Merge the authoritative server list in: server photos become synced entries
   * (replacing any local twin by clientId), local pending/failed entries the
   * server does not know yet are kept. A previously-synced local entry missing
   * from the server list was deleted elsewhere — it is dropped.
   */
  setServerPhotos: (list: BeerPhoto[]) => void;
  /** Insert an optimistic pending entry for a queued upload. */
  addPendingPhoto: (input: PendingBeerPhotoInput) => void;
  /** The queued upload landed: swap in the server photo, drop localUri. */
  markSynced: (clientId: string, serverPhoto: BeerPhoto) => void;
  /** The queued upload was permanently rejected (code → specific error copy). */
  markFailed: (clientId: string, failureCode?: string) => void;
  /** Remove one photo by server id or clientId (delete flow / failed cleanup). */
  removePhoto: (idOrClientId: string) => void;
}

export const useBeerPhotosStore = create<BeerPhotosState>()(
  persist(
    (set) => ({
      photos: [],

      setServerPhotos: (list) =>
        set((state) => {
          const serverByClientId = new Set(list.map((p) => p.clientId).filter(Boolean));
          const serverIds = new Set(list.map((p) => p.id));
          const keptLocals = state.photos.filter(
            (photo) =>
              photo.syncState !== 'synced' &&
              !serverByClientId.has(photo.clientId) &&
              (photo.id == null || !serverIds.has(photo.id)),
          );
          return { photos: sortNewestFirst([...list.map(fromServerPhoto), ...keptLocals]) };
        }),

      addPendingPhoto: (input) =>
        set((state) => {
          const entry: BeerPhotoLocal = {
            id: null,
            clientId: input.clientId,
            imageUrl: null,
            caption: input.caption,
            pubCacheKey: input.pubCacheKey ?? '',
            pubName: input.pubName ?? '',
            pubCity: input.pubCity ?? '',
            visibility: input.visibility,
            takenAt: input.takenAt,
            createdAt: input.takenAt,
            inContest: false,
            localUri: input.localUri,
            syncState: 'pending',
          };
          const others = state.photos.filter((photo) => photo.clientId !== input.clientId);
          return { photos: sortNewestFirst([entry, ...others]) };
        }),

      markSynced: (clientId, serverPhoto) =>
        set((state) => ({
          photos: state.photos.map((photo) =>
            photo.clientId === clientId ? fromServerPhoto(serverPhoto) : photo,
          ),
        })),

      markFailed: (clientId, failureCode) =>
        set((state) => ({
          photos: state.photos.map((photo) =>
            photo.clientId === clientId && photo.syncState !== 'synced'
              ? { ...photo, syncState: 'failed' as const, failureCode }
              : photo,
          ),
        })),

      removePhoto: (idOrClientId) =>
        set((state) => ({
          photos: state.photos.filter(
            (photo) => photo.id !== idOrClientId && photo.clientId !== idOrClientId,
          ),
        })),
    }),
    {
      name: 'na-pivo-beer-photos',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
    },
  ),
);

/**
 * Rehydrate exactly once per process: re-running rehydrate() on every
 * loadBeerPhotos call would clobber live in-memory state (e.g. a markSynced
 * that landed mid-flush) with the stale persisted snapshot.
 */
let rehydratedOnce = false;

/**
 * Bootstrap the diary: wait for the persisted state to hydrate (so pending
 * photos are visible immediately — first call only), then reconcile with the
 * server list. Silent on failure — offline just keeps the local view. Never
 * throws.
 */
export async function loadBeerPhotos(signal?: AbortSignal): Promise<void> {
  if (!rehydratedOnce) {
    rehydratedOnce = true;
    try {
      await useBeerPhotosStore.persist.rehydrate();
    } catch {
      // A failed rehydrate only loses the cached view; the fetch below still runs.
    }
  }
  const photos = await fetchMyBeerPhotos(signal);
  if (photos) useBeerPhotosStore.getState().setServerPhotos(photos);
}
