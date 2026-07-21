/**
 * Client for adding pubs missing from the nearby search.
 *
 * The write is authenticated with the anonymous device account and is
 * best-effort: callers should queue through addedPubsQueue so offline submits
 * eventually reach the backend. Wire format is snake_case; UI code stays
 * camelCase.
 */

import { ensureAccount, clearCachedAnonymousAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { trackApiFailure } from './telemetryClient';

export interface AddedPubInput {
  name: string;
  lat: number;
  lng: number;
  city?: string;
  address?: string;
}

export interface AddedPubEntry {
  client_id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  address?: string;
}

export interface AddedPubResponse {
  clientId: string;
  cacheKey: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  address?: string;
}

interface WireResponse {
  client_id?: string;
  cache_key?: string;
  name?: string;
  lat?: number;
  lng?: number;
  city?: string;
  address?: string;
}

const REQUEST_TIMEOUT_MS = 8000;

export type SubmitAddedPubResult = AddedPubResponse | 'permanent-error' | 'retry';

export interface AddedPubEditEntry {
  client_id: string;
  name?: string;
  lat?: number;
  lng?: number;
  city?: string;
  address?: string;
}

export function buildAddedPubEntry(input: AddedPubInput, clientId: string): AddedPubEntry {
  const entry: AddedPubEntry = {
    client_id: clientId,
    name: input.name.trim(),
    lat: input.lat,
    lng: input.lng,
  };
  const city = input.city?.trim();
  const address = input.address?.trim();
  if (city) entry.city = city;
  if (address) entry.address = address;
  return entry;
}

export async function submitAddedPub(
  entry: AddedPubEntry,
  signal?: AbortSignal,
): Promise<SubmitAddedPubResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint('/v1/pubs');
  if (!endpoint) return 'retry';

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return 'retry';

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(entry),
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'added_pub_submit',
        endpoint: '/v1/pubs',
      });
      return 'retry';
    }
    if (!resp.ok) {
      const result: SubmitAddedPubResult =
        resp.status === 400 || resp.status === 422 ? 'permanent-error' : 'retry';
      trackApiFailure('added_pub_submit', {
        endpoint: '/v1/pubs',
        status: resp.status,
        sync_result: result,
        retryable: result === 'retry',
      });
      return result;
    }

    const data = (await resp.json()) as WireResponse;
    if (!data?.client_id || !data.cache_key || !data.name || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
      return 'retry';
    }
    return {
      clientId: data.client_id,
      cacheKey: data.cache_key,
      name: data.name,
      lat: data.lat,
      lng: data.lng,
      city: data.city || undefined,
      address: data.address || undefined,
    };
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('added_pub_submit', {
        endpoint: '/v1/pubs',
        reason: 'exception',
        error: err,
        sync_result: 'retry',
        retryable: true,
      });
    }
    return 'retry';
  } finally {
    abort.cleanup();
  }
}

async function authenticatedAddedPubRequest(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<SubmitAddedPubResult> {
  if (signal?.aborted) return 'retry';
  const endpoint = getBackendEndpoint(path);
  if (!endpoint) return 'retry';
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return 'retry';
  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        ...init.headers,
      },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'added_pub_edit',
        endpoint: path,
      });
      return 'retry';
    }
    if (!resp.ok) {
      const result = resp.status === 400 || resp.status === 404 || resp.status === 422
        ? 'permanent-error'
        : 'retry';
      trackApiFailure('added_pub_edit', {
        endpoint: '/v1/pubs/<client_id>',
        status: resp.status,
        sync_result: result,
        retryable: result === 'retry',
      });
      return result;
    }
    const data = (await resp.json()) as WireResponse;
    if (!data.client_id || !data.cache_key || !data.name || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
      return 'retry';
    }
    return {
      clientId: data.client_id,
      cacheKey: data.cache_key,
      name: data.name,
      lat: data.lat,
      lng: data.lng,
      city: data.city || undefined,
      address: data.address || undefined,
    };
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('added_pub_edit', {
        endpoint: '/v1/pubs/<client_id>',
        reason: 'exception',
        error: err,
        sync_result: 'retry',
        retryable: true,
      });
    }
    return 'retry';
  } finally {
    abort.cleanup();
  }
}

export function submitAddedPubEdit(
  entry: AddedPubEditEntry,
  signal?: AbortSignal,
): Promise<SubmitAddedPubResult> {
  return authenticatedAddedPubRequest(
    `/v1/pubs/${encodeURIComponent(entry.client_id)}`,
    { method: 'PATCH', body: JSON.stringify(entry) },
    signal,
  );
}

export async function fetchOwnAddedPubs(signal?: AbortSignal): Promise<AddedPubResponse[] | null> {
  if (signal?.aborted) return null;
  const endpoint = getBackendEndpoint('/v1/pubs');
  if (!endpoint) return null;
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;
  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'added_pub_list',
        endpoint: '/v1/pubs',
      });
      return null;
    }
    if (!resp.ok) return null;
    const rows = (await resp.json()) as WireResponse[];
    if (!Array.isArray(rows)) return null;
    return rows.flatMap((data) =>
      data.client_id && data.cache_key && data.name && typeof data.lat === 'number' && typeof data.lng === 'number'
        ? [{
            clientId: data.client_id,
            cacheKey: data.cache_key,
            name: data.name,
            lat: data.lat,
            lng: data.lng,
            city: data.city || undefined,
            address: data.address || undefined,
          }]
        : [],
    );
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}
