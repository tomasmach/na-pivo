/**
 * Beer-photo diary client — the wire layer for the "FotoPivař" photo diary
 * (POST/GET/DELETE /v1/beer-photos and the friend gallery).
 *
 * The upload MUST go through expo-file-system's native multipart uploader
 * (File.upload): Expo SDK 56's WinterCG fetch rejects the legacy RN
 * {uri,name,type} FormData part with "Unsupported FormDataPart implementation".
 * Extra form fields ride in `parameters`. A 30s abort budget caps the upload
 * (slower than the shared 9-12s API budgets).
 *
 * `uploadBeerPhoto` returns the queue keep/drop classification directly
 * ('ok' | 'retry' | 'permanent-error') so beerPhotosQueue can persist-before-send
 * and reuse the shared retry contract. The POST is idempotent by client_id, so a
 * re-sent upload never duplicates the photo server-side.
 */

import { File, UploadType } from 'expo-file-system';

import { ensureAccount, type AccountSession } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint, getBackendUrl } from './backendConfig';
import type { FriendActionError, FriendActionResult } from './friendsClient';
import { trackApiFailure } from './telemetryClient';

const REQUEST_TIMEOUT_MS = 9000;
/** Upload budget — wider than the shared API timeout (uploads are slower). */
const UPLOAD_TIMEOUT_MS = 30000;

export type BeerPhotoVisibility = 'private' | 'friends';

/** One diary photo, camelCased off the wire. `imageUrl` is resolved to absolute. */
export interface BeerPhoto {
  id: string;
  clientId: string;
  imageUrl: string;
  caption: string;
  pubCacheKey: string;
  pubName: string;
  pubCity: string;
  visibility: BeerPhotoVisibility;
  takenAt: string;
  createdAt: string;
  inContest: boolean;
}

/** The multipart form fields that accompany the JPEG on POST /v1/beer-photos. */
export interface BeerPhotoUploadFields {
  clientId: string;
  caption: string;
  pubCacheKey?: string;
  pubName?: string;
  pubCity?: string;
  visibility: BeerPhotoVisibility;
  /** ISO-8601 timestamp of when the photo was taken. */
  takenAt: string;
}

/**
 * Discriminated upload outcome carrying the queue keep/drop classification:
 *   - ok              → 2xx, photo persisted server-side; drop from queue.
 *   - retry           → transient (offline, 401, 429, 5xx, timeout); keep queued.
 *   - permanent-error → 400/422 (photo_limit_reached, photo_too_large,
 *                       photo_invalid, …); will never succeed, drop + mark failed.
 */
export type BeerPhotoUploadResult =
  | { status: 'ok'; photo: BeerPhoto }
  | { status: 'retry' }
  | { status: 'permanent-error'; code?: string };

interface RawBeerPhoto {
  id?: string;
  client_id?: string;
  image_url?: string | null;
  caption?: string;
  pub_cache_key?: string;
  pub_name?: string;
  pub_city?: string;
  visibility?: string;
  taken_at?: string;
  created_at?: string;
  in_contest?: boolean;
}

export function parseBeerPhotoVisibility(value: unknown): BeerPhotoVisibility {
  return value === 'friends' ? 'friends' : 'private';
}

/**
 * Resolve a wire image URL to an absolute one. The backend normally mints
 * absolute URLs (like avatars), but a relative path is defensively prefixed with
 * the backend base so <Image source={{uri}}> always loads.
 */
export function resolveBeerPhotoUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = getBackendUrl();
  if (!base) return raw;
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmedBase}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

/** wire → app mapper; tolerant of missing fields (never throws). */
export function beerPhotoFromWire(raw: RawBeerPhoto): BeerPhoto {
  return {
    id: raw.id ?? '',
    clientId: raw.client_id ?? '',
    imageUrl: resolveBeerPhotoUrl(raw.image_url),
    caption: raw.caption ?? '',
    pubCacheKey: raw.pub_cache_key ?? '',
    pubName: raw.pub_name ?? '',
    pubCity: raw.pub_city ?? '',
    visibility: parseBeerPhotoVisibility(raw.visibility),
    takenAt: raw.taken_at ?? '',
    createdAt: raw.created_at ?? '',
    inContest: raw.in_contest === true,
  };
}

/**
 * Upload one diary photo (multipart, file field `image`, JPEG) with its form
 * fields. Never throws; returns the queue classification (see
 * BeerPhotoUploadResult). Idempotent by client_id, so 'retry' is always safe.
 */
export async function uploadBeerPhoto(
  localUri: string,
  fields: BeerPhotoUploadFields,
  signal?: AbortSignal,
): Promise<BeerPhotoUploadResult> {
  const endpoint = getBackendEndpoint('/v1/beer-photos');
  if (!endpoint || signal?.aborted) return { status: 'retry' };

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return { status: 'retry' };

  const abort = chainAbortSignal(signal, UPLOAD_TIMEOUT_MS);
  try {
    const resp = await new File(localUri).upload(endpoint, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'image',
      mimeType: 'image/jpeg',
      headers: { Authorization: `Bearer ${session.token}` },
      parameters: {
        client_id: fields.clientId,
        caption: fields.caption,
        pub_cache_key: fields.pubCacheKey ?? '',
        pub_name: fields.pubName ?? '',
        pub_city: fields.pubCity ?? '',
        visibility: fields.visibility,
        taken_at: fields.takenAt,
      },
      signal: abort.signal,
    });

    let data: Record<string, unknown> = {};
    try {
      data = resp.body ? (JSON.parse(resp.body) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }

    if (resp.status >= 200 && resp.status < 300) {
      return { status: 'ok', photo: beerPhotoFromWire((data.photo ?? {}) as RawBeerPhoto) };
    }
    const classified = await classifyQueueHttpFailure(resp.status, session);
    if (classified === 'permanent-error') {
      return {
        status: 'permanent-error',
        code: typeof data.code === 'string' ? data.code : undefined,
      };
    }
    return { status: 'retry' };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbort) {
      trackApiFailure('beer_photos_upload', {
        endpoint: '/v1/beer-photos',
        reason: 'exception',
        error: err,
      });
    }
    return { status: 'retry' };
  } finally {
    abort.cleanup();
  }
}

interface RequestOk {
  ok: true;
  data: Record<string, unknown>;
}

type RequestResult = RequestOk | { ok: false; result: FriendActionError };

function extractError(data: Record<string, unknown>, status: number): FriendActionError {
  const detail =
    typeof data.detail === 'string' ? data.detail : 'Nepodařilo se to uložit. Zkus to znovu.';
  const code = typeof data.code === 'string' ? data.code : `http_${status}`;
  return { ok: false, code, detail };
}

async function handleUnauthorized(session: AccountSession): Promise<void> {
  await classifyQueueHttpFailure(401, session);
}

async function requestJson(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<RequestResult> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'offline', detail: 'Server teď není dostupný.' } };
  }

  const session = await ensureAccount(options.signal);
  if (!session || options.signal?.aborted) {
    return { ok: false, result: { ok: false, code: 'account', detail: 'Účet teď není připravený.' } };
  }

  const abort = chainAbortSignal(options.signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: abort.signal,
    });
    let data: Record<string, unknown> = {};
    try {
      const text = await resp.text();
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    if (resp.status === 401) {
      await handleUnauthorized(session);
      return { ok: false, result: { ok: false, code: 'auth', detail: 'Přihlášení vypršelo.' } };
    }
    if (!resp.ok) return { ok: false, result: extractError(data, resp.status) };
    return { ok: true, data };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (!options.signal?.aborted && !isAbort) {
      trackApiFailure('beer_photos_request', { endpoint: path, reason: 'exception', error: err });
    }
    return { ok: false, result: { ok: false, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' } };
  } finally {
    abort.cleanup();
  }
}

/** GET /v1/beer-photos — my diary, newest first. null on any failure. */
export async function fetchMyBeerPhotos(signal?: AbortSignal): Promise<BeerPhoto[] | null> {
  const res = await requestJson('/v1/beer-photos', { signal });
  if (!res.ok) return null;
  return Array.isArray(res.data.photos)
    ? (res.data.photos as RawBeerPhoto[]).map(beerPhotoFromWire)
    : [];
}

/** DELETE /v1/beer-photos/<id> — online-only (no queue). */
export async function deleteBeerPhoto(photoId: string): Promise<FriendActionResult> {
  const res = await requestJson(`/v1/beer-photos/${encodeURIComponent(photoId)}`, {
    method: 'DELETE',
  });
  return res.ok ? { ok: true } : res.result;
}

/**
 * GET /v1/friends/<public_id>/beer-photos — a friend's friends-visible photos.
 * null on any failure, including 404 when not allowed (not friends / private).
 */
export async function fetchFriendBeerPhotos(
  publicId: string,
  signal?: AbortSignal,
): Promise<BeerPhoto[] | null> {
  const res = await requestJson(
    `/v1/friends/${encodeURIComponent(publicId)}/beer-photos`,
    { signal },
  );
  if (!res.ok) return null;
  return Array.isArray(res.data.photos)
    ? (res.data.photos as RawBeerPhoto[]).map(beerPhotoFromWire)
    : [];
}
