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
  cacheKey: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  address?: string;
}

interface WireResponse {
  cache_key?: string;
  name?: string;
  lat?: number;
  lng?: number;
  city?: string;
  address?: string;
}

const REQUEST_TIMEOUT_MS = 8000;

function chainAbortSignal(signal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();

  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort);
    }
  }

  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
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
): Promise<AddedPubResponse | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/pubs');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal);
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
      await clearCachedAnonymousAccount(session);
      return null;
    }
    if (!resp.ok) {
      trackApiFailure('added_pub_submit', {
        endpoint: '/v1/pubs',
        status: resp.status,
      });
      return null;
    }

    const data = (await resp.json()) as WireResponse;
    if (!data?.cache_key || !data.name || typeof data.lat !== 'number' || typeof data.lng !== 'number') {
      return null;
    }
    return {
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
      });
    }
    return null;
  } finally {
    abort.cleanup();
  }
}
