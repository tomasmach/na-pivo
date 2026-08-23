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
import { persistedArray, persistedObject } from '@/stores/persistedSchemas';
import AsyncStorage, {
  privateAccountCleanupStorage,
  suppressPrivatePersistenceDuringMemoryReset,
} from '@/data/privateAccountStorage';
import {
  guardPrivateAccountStateCreator,
  isPrivateAccountMutationFrozen,
} from '@/data/privateAccountBoundary';

import {
  fetchMyBeerPhotos,
  type BeerPhoto,
  type BeerPhotoVisibility,
} from '@/data/beerPhotosClient';
import { ensureAccount, readDurableAccountSession } from '@/data/account';
import {
  isBeerPhotoDeletionTombstoned,
  loadBeerPhotoDeletionTombstones,
} from '@/data/beerPhotoDeletionTombstones';

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
  /** Local association retained until the party record reflects the upload. */
  partyCode?: string;
  /** Reserved table code whose create request has not been confirmed yet. */
  pendingPartyCode?: string;
  /** Local-only party association for a night that has no server code yet. */
  partyDrinkingDay?: string;
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
  partyCode?: string;
  pendingPartyCode?: string;
  partyDrinkingDay?: string;
  visibility: BeerPhotoVisibility;
  takenAt: string;
}

function fromServerPhoto(
  photo: BeerPhoto,
  localParty?: {
    partyCode?: string;
    pendingPartyCode?: string;
    partyDrinkingDay?: string;
  },
): BeerPhotoLocal {
  return {
    id: photo.id,
    clientId: photo.clientId,
    imageUrl: photo.imageUrl,
    caption: photo.caption,
    pubCacheKey: photo.pubCacheKey,
    pubName: photo.pubName,
    pubCity: photo.pubCity,
    ...(localParty?.partyCode ? { partyCode: localParty.partyCode } : {}),
    ...(localParty?.pendingPartyCode
      ? { pendingPartyCode: localParty.pendingPartyCode }
      : {}),
    ...(localParty?.partyDrinkingDay
      ? { partyDrinkingDay: localParty.partyDrinkingDay }
      : {}),
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
  setServerPhotos: (list: BeerPhoto[], accountId?: string) => void;
  /** Insert an optimistic pending entry for a queued upload. */
  addPendingPhoto: (input: PendingBeerPhotoInput) => void;
  /**
   * The queued upload landed: swap in the server photo, drop localUri, and
   * resolve true only once that exact synced snapshot is durable.
   */
  markSynced: (clientId: string, serverPhoto: BeerPhoto) => Promise<boolean>;
  /** The queued upload was permanently rejected (code → specific error copy). */
  markFailed: (clientId: string, failureCode?: string) => void;
  /** Replace a reserved table code after its create request settles. */
  resolvePendingPartyAssociation: (
    pendingPartyCode: string,
    confirmedPartyCode: string | null,
  ) => void;
  /** Remove one photo by server id or clientId (delete flow / failed cleanup). */
  removePhoto: (idOrClientId: string) => void;
}

/**
 * Account-boundary and request epochs for the private photo diary.
 *
 * A fetch or AsyncStorage rehydrate may finish after logout has already wiped
 * account A. Both epochs are bumped synchronously at the boundary, before the
 * clear can yield, so that late work cannot repopulate (or persist) A's photos
 * under account B. The request epoch also gives overlapping same-account loads
 * a deterministic newest-request-wins policy.
 */
let accountBoundaryGeneration = 0;
let latestLoadGeneration = 0;
let accountClearsInProgress = 0;
let lastClearedSession: { accountId: string; token: string } | null = null;
let hydrationStarts = 0;
/**
 * The boundary generation whose diary has already been reconciled with the
 * server. Opening Profil is not new information, so the second and every later
 * mount rides the state the first one fetched; an account switch bumps the
 * generation and the next open reconciles again.
 */
let reconciledGeneration: number | null = null;
let resolveInitialHydration!: () => void;
const initialHydration = new Promise<void>((resolve) => {
  resolveInitialHydration = resolve;
});

function beginHydration(): () => void {
  const generation = accountBoundaryGeneration;
  const startedDuringAccountClear = accountClearsInProgress > 0;
  const isInitialHydration = hydrationStarts === 0;
  hydrationStarts += 1;

  return () => {
    if (isInitialHydration) resolveInitialHydration();
    if (
      startedDuringAccountClear ||
      accountClearsInProgress > 0 ||
      generation !== accountBoundaryGeneration
    ) {
      // Persist applies the hydrated snapshot before this completion hook.
      // Undo any snapshot whose read crossed an account boundary. There is no
      // hydration counter to wait on: Zustand intentionally suppresses the
      // older completion callback when two rehydrates overlap.
      useBeerPhotosStore.setState({ photos: [] });
      void useBeerPhotosStore.persist.clearStorage();
    }
  };
}

function loadIsStale(
  boundaryGeneration: number,
  loadGeneration: number,
  signal?: AbortSignal,
): boolean {
  return (
    signal?.aborted === true ||
    accountClearsInProgress > 0 ||
    boundaryGeneration !== accountBoundaryGeneration ||
    loadGeneration !== latestLoadGeneration
  );
}

function belongsToLastClearedSession(session: { accountId: string; token: string }): boolean {
  if (!lastClearedSession) return false;
  if (
    session.accountId === lastClearedSession.accountId &&
    session.token === lastClearedSession.token
  ) return true;

  // The identity really rotated. Forget the outgoing credential so a later
  // login to the same account (with a fresh token) can load normally.
  lastClearedSession = null;
  return false;
}

export const useBeerPhotosStore = create<BeerPhotosState>()(
  persist(
    guardPrivateAccountStateCreator((set, get) => ({
      photos: [],

      setServerPhotos: (list, accountId) =>
        set((state) => {
          // A GET may race the delete request or return a snapshot captured
          // before it. Never rehydrate a locally-deleted identity while its
          // durable tombstone is still pending server acknowledgement.
          const visibleList = list.filter(
            (photo) => !isBeerPhotoDeletionTombstoned(photo.clientId, accountId),
          );
          const serverByClientId = new Set(
            visibleList.map((p) => p.clientId).filter(Boolean),
          );
          const serverIds = new Set(visibleList.map((p) => p.id));
          const keptLocals = state.photos.filter(
            (photo) =>
              !isBeerPhotoDeletionTombstoned(photo.clientId, accountId) &&
              photo.syncState !== 'synced' &&
              !serverByClientId.has(photo.clientId) &&
              (photo.id == null || !serverIds.has(photo.id)),
          );
          const previousParty = new Map(
            state.photos.map((photo) => [
              photo.clientId,
              {
                ...(photo.partyCode ? { partyCode: photo.partyCode } : {}),
                ...(photo.pendingPartyCode
                  ? { pendingPartyCode: photo.pendingPartyCode }
                  : {}),
                ...(photo.partyDrinkingDay
                  ? { partyDrinkingDay: photo.partyDrinkingDay }
                  : {}),
              },
            ] as const),
          );
          return {
            photos: sortNewestFirst([
              ...visibleList.map((photo) =>
                fromServerPhoto(photo, previousParty.get(photo.clientId)),
              ),
              ...keptLocals,
            ]),
          };
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
            ...(input.partyCode ? { partyCode: input.partyCode } : {}),
            ...(input.pendingPartyCode
              ? { pendingPartyCode: input.pendingPartyCode }
              : {}),
            ...(input.partyDrinkingDay
              ? { partyDrinkingDay: input.partyDrinkingDay }
              : {}),
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

      markSynced: async (clientId, serverPhoto) => {
        const boundaryGeneration = accountBoundaryGeneration;
        try {
          // Zustand persist returns the exact storage write from its wrapped
          // setter at runtime (its public setter type still says `void`). Await
          // that write before the upload queue is allowed to release its only
          // recoverable op and JPEG.
          const persistence = (
            set as unknown as (
              update: (
                state: BeerPhotosState,
              ) => Pick<BeerPhotosState, 'photos'>
            ) => void | Promise<void>
          )((state) => ({
            photos: state.photos.map((photo) =>
              photo.clientId === clientId
                ? fromServerPhoto(serverPhoto, {
                    partyCode: photo.partyCode,
                    pendingPartyCode: photo.pendingPartyCode,
                    partyDrinkingDay: photo.partyDrinkingDay,
                  })
                : photo,
            ),
          }));
          await persistence;
        } catch {
          return false;
        }

        if (
          isPrivateAccountMutationFrozen() ||
          accountClearsInProgress > 0 ||
          boundaryGeneration !== accountBoundaryGeneration
        ) return false;

        return get().photos.some(
          (photo) =>
            photo.clientId === clientId &&
            photo.id === serverPhoto.id &&
            photo.syncState === 'synced',
        );
      },

      markFailed: (clientId, failureCode) =>
        set((state) => ({
          photos: state.photos.map((photo) =>
            photo.clientId === clientId && photo.syncState !== 'synced'
              ? { ...photo, syncState: 'failed' as const, failureCode }
              : photo,
          ),
        })),

      resolvePendingPartyAssociation: (pendingPartyCode, confirmedPartyCode) =>
        set((state) => ({
          photos: state.photos.map((photo) => {
            if (
              photo.pendingPartyCode?.toUpperCase() !==
              pendingPartyCode.toUpperCase()
            ) return photo;
            const { pendingPartyCode: _pendingPartyCode, partyCode: _partyCode, ...rest } = photo;
            return confirmedPartyCode
              ? { ...rest, partyCode: confirmedPartyCode.toUpperCase() }
              : rest;
          }),
        })),

      removePhoto: (idOrClientId) =>
        set((state) => ({
          photos: state.photos.filter(
            (photo) => photo.id !== idOrClientId && photo.clientId !== idOrClientId,
          ),
        })),
    })),
    {
      name: 'na-pivo-beer-photos',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      merge: (persisted, current) => {
        const state = persistedObject(persisted);
        return { ...current, photos: persistedArray<BeerPhotoLocal>(state.photos) };
      },
      onRehydrateStorage: () => {
        const finishHydration = beginHydration();
        return () => finishHydration();
      },
    },
  ),
);

/**
 * Wipe the private diary at an account boundary. The clear-in-progress flag is
 * raised synchronously, before any await, and the outgoing credential remains
 * blocked until a genuinely different session is observed.
 */
export function clearBeerPhotosAccountData(options?: {
  /** Captured before an already-installed replacement session. */
  outgoingSession?: { accountId: string; token: string } | null;
}): Promise<void> {
  accountClearsInProgress += 1;
  accountBoundaryGeneration += 1;
  latestLoadGeneration += 1;
  suppressPrivatePersistenceDuringMemoryReset(() => {
    useBeerPhotosStore.setState({ photos: [] });
  });
  const outgoingSession = Object.prototype.hasOwnProperty.call(
    options ?? {},
    'outgoingSession',
  )
    ? Promise.resolve(options?.outgoingSession ?? null)
    : ensureAccount();

  return (async () => {
    try {
      const [session] = await Promise.all([
        outgoingSession.catch(() => null),
        privateAccountCleanupStorage.removeItem('na-pivo-beer-photos').catch(() => undefined),
      ]);
      if (session) {
        lastClearedSession = { accountId: session.accountId, token: session.token };
      }
    } finally {
      // Invalidate once more before reopening: a load may have started while a
      // different private-clear task was yielding after the first bump.
      accountBoundaryGeneration += 1;
      latestLoadGeneration += 1;
      suppressPrivatePersistenceDuringMemoryReset(() => {
        useBeerPhotosStore.setState({ photos: [] });
      });
      try {
        await privateAccountCleanupStorage.removeItem('na-pivo-beer-photos');
      } catch {
        // privateAccountData removes the same key too; memory is already empty.
      } finally {
        accountClearsInProgress = Math.max(0, accountClearsInProgress - 1);
      }
    }
  })();
}

/**
 * Bootstrap the diary: wait for the persisted state to hydrate (so pending
 * photos are visible immediately — first call only), then reconcile with the
 * server list. Silent on failure — offline just keeps the local view. Never
 * throws.
 *
 * `once` skips the request when this account has already been reconciled, for
 * callers that mount on every screen open rather than on a refresh gesture.
 */
export async function loadBeerPhotos(
  signal?: AbortSignal,
  options: { once?: boolean } = {},
): Promise<void> {
  const boundaryGeneration = accountBoundaryGeneration;
  if (options.once && reconciledGeneration === boundaryGeneration) return;
  const loadGeneration = ++latestLoadGeneration;

  if (loadIsStale(boundaryGeneration, loadGeneration, signal)) return;
  const [, tombstoneLoad] = await Promise.all([
    initialHydration,
    loadBeerPhotoDeletionTombstones(),
  ]);
  if (
    !tombstoneLoad.ok ||
    loadIsStale(boundaryGeneration, loadGeneration, signal)
  ) return;

  // Nobody has an account yet: reconciling would provision one behind the back
  // of someone who only opened Profil. The local album is already hydrated —
  // the server has nothing to add until there is an identity to ask about.
  const durable = await readDurableAccountSession();
  if (!durable.session || loadIsStale(boundaryGeneration, loadGeneration, signal)) return;

  const session = await ensureAccount(signal);
  if (
    !session ||
    loadIsStale(boundaryGeneration, loadGeneration, signal) ||
    belongsToLastClearedSession(session)
  ) return;

  const photos = await fetchMyBeerPhotos(signal, session);
  if (!photos || loadIsStale(boundaryGeneration, loadGeneration, signal)) return;

  // A generation bump is the fast account-boundary guard. Comparing the
  // captured identity as well also protects unusual session replacements that
  // did not go through clearLocalPrivateAccountData.
  const currentSession = await ensureAccount(signal);
  if (
    !currentSession ||
    currentSession.accountId !== session.accountId ||
    currentSession.token !== session.token ||
    loadIsStale(boundaryGeneration, loadGeneration, signal) ||
    belongsToLastClearedSession(currentSession)
  ) return;

  reconciledGeneration = boundaryGeneration;
  useBeerPhotosStore.getState().setServerPhotos(photos, session.accountId);
}
