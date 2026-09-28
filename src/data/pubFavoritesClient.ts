/**
 * Private favourite pubs ("srdcovky") sync client — saves or removes one
 * favourite and pulls the account's set back down.
 *
 * Same conventions as pubRatingsClient: best-effort Bearer requests with an 8 s
 * timeout that never throw. Delivery guarantees live in pubFavoritesQueue.ts,
 * restore/merge in pubFavoritesSync.ts. A favourite is the user's own list; it
 * reaches the backend only so the same account sees it on every device.
 *
 * Removals are a PUT with `favorite: false` and a timestamp, so the server can
 * apply the same last-write-wins rule as saves. A save beyond the account cap
 * answers 409, which the queue keeps and retries instead of dropping.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal, classifyQueueHttpFailure } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';

/** One favourite in backend (snake_case) wire form for a PUT. */
export interface WireFavoriteUpsert {
  name?: string;
  lat: number;
  lng: number;
  external_id?: string | null;
  /** false removes the favourite under the same timestamp guard. */
  favorite: boolean;
  /** ISO-8601 of the last local change — drives last-write-wins on the server. */
  updated_at: string;
}

/** One favourite as returned by GET /v1/pub-favorites. */
export interface WireFavorite {
  /** geohash-8 cell key = the local pubKey. */
  cache_key: string;
  name: string;
  lat: number;
  lng: number;
  external_id: string;
  updated_at: string;
}

export type SubmitFavoriteResult = 'ok' | 'permanent-error' | 'retry';

const ENDPOINT = '/v1/pub-favorites';
const REQUEST_TIMEOUT_MS = 8000;

/** PUT one save or removal. Never throws. */
export async function submitFavorite(
  payload: WireFavoriteUpsert,
  signal?: AbortSignal,
): Promise<SubmitFavoriteResult> {
  if (signal?.aborted) return 'retry';
  const endpoint = getBackendEndpoint(ENDPOINT);
  if (!endpoint) return 'retry';
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return 'retry';

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });
    if (resp.ok) return 'ok';
    return await classifyQueueHttpFailure(resp.status, session, {
      source: 'favorite_submit',
      endpoint: ENDPOINT,
    });
  } catch {
    return 'retry';
  } finally {
    abort.cleanup();
  }
}

function isWireFavorite(value: unknown): value is WireFavorite {
  const f = value as WireFavorite;
  return (
    !!f &&
    typeof f.cache_key === 'string' &&
    typeof f.name === 'string' &&
    typeof f.lat === 'number' &&
    typeof f.lng === 'number' &&
    typeof f.updated_at === 'string'
  );
}

/** GET the account's favourites, or null on any failure. Never throws. */
export async function fetchFavorites(signal?: AbortSignal): Promise<WireFavorite[] | null> {
  if (signal?.aborted) return null;
  const endpoint = getBackendEndpoint(ENDPOINT);
  if (!endpoint) return null;
  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, {
        source: 'favorites_fetch',
        endpoint: ENDPOINT,
      });
      return null;
    }
    if (!resp.ok) return null;
    const data = (await resp.json()) as { favorites?: unknown };
    if (!data || !Array.isArray(data.favorites)) return null;
    return data.favorites.filter(isWireFavorite);
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}
