/**
 * Durable state registry for user-added pubs.
 *
 * Unlike a fire-and-forget queue, settled rows stay here so the user can see
 * whether a public addition is waiting, live, or needs attention. Pending
 * creates and owner edits retry on launch/foreground and share the original
 * client id, making both operations idempotent and offline-safe.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchOwnAddedPubs,
  submitAddedPub,
  submitAddedPubEdit,
  type AddedPubEditEntry,
  type AddedPubEntry,
  type AddedPubResponse,
  type SubmitAddedPubResult,
} from './addedPubsClient';
import { clearPubsSnapshot, pubIdForCoords, removeLocalPub, upsertLocalPub } from './pubs';
import { createQueueLock } from './createQueue';

const STORAGE_KEY = 'na-pivo-added-pubs-queue';
const MAX_SYNCED_SUBMISSIONS = 30;

export type AddedPubSyncState = 'pending' | 'synced' | 'failed';

export interface AddedPubSubmission extends AddedPubEntry {
  syncState: AddedPubSyncState;
  pendingOperation: 'create' | 'edit' | null;
  updatedAt: string;
  /** Last server-confirmed value used to undo a permanently rejected edit. */
  rollback?: AddedPubEntry;
  /** Exact partial PATCH to retry without turning a rename into a location edit. */
  pendingEdit?: AddedPubEditEntry;
}

function normalizePendingEdit(value: unknown, clientId: string): AddedPubEditEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<AddedPubEditEntry>;
  const pending: AddedPubEditEntry = { client_id: clientId };
  if (typeof candidate.name === 'string') pending.name = candidate.name;

  const hasLocation =
    typeof candidate.lat === 'number' &&
    typeof candidate.lng === 'number' &&
    typeof candidate.city === 'string' &&
    typeof candidate.address === 'string';
  if (hasLocation) {
    pending.lat = candidate.lat;
    pending.lng = candidate.lng;
    pending.city = candidate.city;
    pending.address = candidate.address;
  }
  return pending.name !== undefined || hasLocation ? pending : undefined;
}

function isAddedPubEntry(entry: unknown): entry is AddedPubEntry {
  const value = entry as AddedPubEntry;
  return (
    !!value &&
    typeof value.client_id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.lat === 'number' &&
    typeof value.lng === 'number' &&
    (value.city === undefined || typeof value.city === 'string') &&
    (value.address === undefined || typeof value.address === 'string')
  );
}

function normalizeSubmission(value: unknown): AddedPubSubmission | null {
  if (!isAddedPubEntry(value)) return null;
  const candidate = value as Partial<AddedPubSubmission>;
  const syncState = ['pending', 'synced', 'failed'].includes(candidate.syncState ?? '')
    ? candidate.syncState as AddedPubSyncState
    : 'pending';
  const pendingOperation = candidate.pendingOperation === 'edit'
    ? 'edit'
    : candidate.pendingOperation === null || syncState === 'synced'
      ? null
      : 'create';
  const pendingEdit = normalizePendingEdit(candidate.pendingEdit, value.client_id);
  return {
    client_id: value.client_id,
    name: value.name,
    lat: value.lat,
    lng: value.lng,
    ...(value.city ? { city: value.city } : {}),
    ...(value.address ? { address: value.address } : {}),
    syncState,
    pendingOperation,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
    ...(isAddedPubEntry(candidate.rollback) ? { rollback: candidate.rollback } : {}),
    ...(pendingEdit ? { pendingEdit } : {}),
  };
}

async function loadRegistry(): Promise<AddedPubSubmission[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const normalized = normalizeSubmission(item);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

async function saveRegistry(items: AddedPubSubmission[]): Promise<void> {
  const keptSyncedIds = new Set(
    items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.syncState === 'synced')
      .sort((left, right) =>
        Date.parse(right.item.updatedAt) - Date.parse(left.item.updatedAt) || right.index - left.index,
      )
      .slice(0, MAX_SYNCED_SUBMISSIONS)
      .map(({ item }) => item.client_id),
  );
  const kept = items.filter(
    (item) => item.syncState !== 'synced' || keptSyncedIds.has(item.client_id),
  );
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
}

const registryTask = createQueueLock();

function isSubmittedPubResponse(result: SubmitAddedPubResult): result is AddedPubResponse {
  return typeof result === 'object' && result !== null;
}

function pubFromSubmission(submission: AddedPubSubmission) {
  return {
    id: pubIdForCoords(submission.lat, submission.lng),
    name: submission.name,
    lat: submission.lat,
    lng: submission.lng,
    ...(submission.city ? { city: submission.city } : {}),
    ...(submission.address ? { address: submission.address } : {}),
    userAddedClientId: submission.client_id,
    venueKind: 'pub' as const,
  };
}

function submissionFromResponse(
  previous: AddedPubSubmission | undefined,
  result: AddedPubResponse,
  updatedAt = previous?.updatedAt ?? new Date().toISOString(),
): AddedPubSubmission {
  return {
    client_id: result.clientId,
    name: result.name,
    lat: result.lat,
    lng: result.lng,
    ...(result.city ? { city: result.city } : {}),
    ...(result.address ? { address: result.address } : {}),
    syncState: 'synced',
    pendingOperation: null,
    updatedAt,
  };
}

function applySubmittedResult(previous: AddedPubSubmission, next: AddedPubSubmission): void {
  const previousId = pubIdForCoords(previous.lat, previous.lng);
  const nextPub = pubFromSubmission(next);
  if (nextPub.id !== previousId) removeLocalPub(previousId);
  upsertLocalPub(nextPub);
}

async function flushLocked(): Promise<void> {
  const registry = await loadRegistry();
  let changed = false;

  for (let index = 0; index < registry.length; index += 1) {
    const submission = registry[index];
    if (submission.syncState !== 'pending' || !submission.pendingOperation) continue;

    const result = submission.pendingOperation === 'create'
      ? await submitAddedPub(submission)
      : await submitAddedPubEdit(submission.pendingEdit ?? {
          // Legacy pending edits predate the partial-payload field and must keep
          // their original full-location retry behavior.
          client_id: submission.client_id,
          name: submission.name,
          lat: submission.lat,
          lng: submission.lng,
          city: submission.city ?? '',
          address: submission.address ?? '',
        });

    if (isSubmittedPubResponse(result)) {
      const synced = submissionFromResponse(submission, result);
      registry[index] = synced;
      applySubmittedResult(submission, synced);
      await clearPubsSnapshot();
      changed = true;
    } else if (result === 'permanent-error') {
      registry[index] = {
        ...submission,
        syncState: 'failed',
        pendingOperation: submission.pendingOperation,
      };
      if (submission.pendingOperation === 'create') {
        removeLocalPub(pubIdForCoords(submission.lat, submission.lng));
      } else if (submission.rollback) {
        removeLocalPub(pubIdForCoords(submission.lat, submission.lng));
        upsertLocalPub(pubFromSubmission({
          ...submission,
          ...submission.rollback,
          syncState: 'synced',
          pendingOperation: null,
        }));
      }
      changed = true;
    }
  }

  if (changed) await saveRegistry(registry);
}

export function loadAddedPubSubmissions(): Promise<AddedPubSubmission[]> {
  return registryTask(loadRegistry);
}

export function enqueueAddedPub(entry: AddedPubEntry): Promise<AddedPubSyncState> {
  return registryTask(async () => {
    const registry = await loadRegistry();
    const submission: AddedPubSubmission = {
      ...entry,
      syncState: 'pending',
      pendingOperation: 'create',
      updatedAt: new Date().toISOString(),
    };
    const next = registry.filter((item) => item.client_id !== entry.client_id);
    next.push(submission);
    await saveRegistry(next);
    upsertLocalPub(pubFromSubmission(submission));
    await flushLocked();
    return (await loadRegistry()).find((item) => item.client_id === entry.client_id)?.syncState ?? 'pending';
  });
}

export function enqueueAddedPubEdit(entry: AddedPubEditEntry): Promise<AddedPubSyncState> {
  return registryTask(async () => {
    const registry = await loadRegistry();
    const previous = registry.find((item) => item.client_id === entry.client_id);
    if (!previous) return 'failed';
    const nextName = entry.name?.trim() || previous.name;
    const locationEdit =
      entry.lat !== undefined &&
      entry.lng !== undefined &&
      entry.city !== undefined &&
      entry.address !== undefined
        ? {
            lat: entry.lat,
            lng: entry.lng,
            city: entry.city.trim(),
            address: entry.address.trim(),
          }
        : null;
    const pendingEdit: AddedPubEditEntry = {
      ...(previous.pendingEdit ?? {}),
      client_id: entry.client_id,
      ...(entry.name !== undefined ? { name: nextName } : {}),
      ...(locationEdit ?? {}),
    };
    const submission: AddedPubSubmission = {
      ...previous,
      name: nextName,
      lat: locationEdit?.lat ?? previous.lat,
      lng: locationEdit?.lng ?? previous.lng,
      city: locationEdit?.city ?? previous.city,
      address: locationEdit?.address ?? previous.address,
      syncState: 'pending',
      pendingOperation: previous.pendingOperation === 'create' ? 'create' : 'edit',
      updatedAt: new Date().toISOString(),
      ...(previous.pendingOperation === 'create' ? {} : { pendingEdit }),
      ...(previous.pendingOperation === 'create'
        ? {}
        : {
            rollback: previous.rollback ?? {
              client_id: previous.client_id,
              name: previous.name,
              lat: previous.lat,
              lng: previous.lng,
              ...(previous.city ? { city: previous.city } : {}),
              ...(previous.address ? { address: previous.address } : {}),
            },
          }),
    };
    const next = registry.map((item) => item.client_id === entry.client_id ? submission : item);
    await saveRegistry(next);
    removeLocalPub(pubIdForCoords(previous.lat, previous.lng));
    upsertLocalPub(pubFromSubmission(submission));
    await clearPubsSnapshot();
    await flushLocked();
    return (await loadRegistry()).find((item) => item.client_id === entry.client_id)?.syncState ?? 'pending';
  });
}

export function retryAddedPub(clientId: string): Promise<AddedPubSyncState | null> {
  return registryTask(async () => {
    const registry = await loadRegistry();
    const index = registry.findIndex((item) => item.client_id === clientId);
    if (index < 0) return null;
    const current = registry[index];
    registry[index] = {
      ...current,
      syncState: 'pending',
      pendingOperation: current.pendingOperation ?? 'create',
      updatedAt: new Date().toISOString(),
    };
    await saveRegistry(registry);
    upsertLocalPub(pubFromSubmission(registry[index]));
    await flushLocked();
    return (await loadRegistry()).find((item) => item.client_id === clientId)?.syncState ?? null;
  });
}

export function flushAddedPubsQueue(): Promise<void> {
  return registryTask(flushLocked);
}

export function syncOwnAddedPubs(): Promise<boolean> {
  return registryTask(async () => {
    const remote = await fetchOwnAddedPubs();
    if (!remote) return false;
    const registry = await loadRegistry();
    const byClientId = new Map(registry.map((item) => [item.client_id, item]));
    const syncStartedAt = Date.now();
    for (const [index, result] of remote.entries()) {
      const previous = byClientId.get(result.clientId);
      // A GET may succeed while a geocoding-backed PATCH is temporarily down.
      // Never let the older server row erase an offline edit or its failed state.
      if (previous && previous.syncState !== 'synced') continue;
      const synced = submissionFromResponse(
        previous,
        result,
        previous?.updatedAt ?? new Date(syncStartedAt - index).toISOString(),
      );
      byClientId.set(result.clientId, synced);
      if (previous) applySubmittedResult(previous, synced);
      else upsertLocalPub(pubFromSubmission(synced));
    }
    await saveRegistry([...byClientId.values()]);
    return true;
  });
}

export function clearAddedPubsQueue(): Promise<void> {
  return registryTask(async () => {
    const registry = await loadRegistry();
    for (const submission of registry) {
      removeLocalPub(pubIdForCoords(submission.lat, submission.lng));
    }
    await saveRegistry([]);
  });
}

export function restoreQueuedAddedPubs(): Promise<number> {
  return registryTask(async () => {
    const registry = await loadRegistry();
    for (const submission of registry) {
      if (submission.syncState !== 'failed') upsertLocalPub(pubFromSubmission(submission));
    }
    return registry.filter((submission) => submission.syncState === 'pending').length;
  });
}
