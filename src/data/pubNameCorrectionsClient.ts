/**
 * Client for pub display-name corrections.
 *
 * A rename is a public community correction, but it must not hide the pub like
 * pub reports do. Callers should queue through pubNameCorrectionsQueue so an
 * offline correction eventually reaches the backend.
 */

import { ensureAccount, clearCachedAnonymousAccount, generateUuidV4 } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { trackApiFailure } from './telemetryClient';
import type { Pub } from './pubs';

export interface PubNameCorrectionEntry {
  client_id: string;
  name: string;
  suggested_name: string;
  lat: number;
  lng: number;
  city?: string;
  address?: string;
  external_id?: string;
}

const REQUEST_TIMEOUT_MS = 8000;

export type SubmitPubNameCorrectionResult = 'ok' | 'permanent-error' | 'retry';

export function buildPubNameCorrectionEntry(
  pub: Pub,
  suggestedName: string,
  clientId = generateUuidV4(),
): PubNameCorrectionEntry {
  const entry: PubNameCorrectionEntry = {
    client_id: clientId,
    name: pub.name.trim(),
    suggested_name: suggestedName.trim(),
    lat: pub.lat,
    lng: pub.lng,
  };
  const city = pub.city?.trim();
  const address = pub.address?.trim();
  if (city) entry.city = city;
  if (address) entry.address = address;
  if (pub.id) entry.external_id = pub.id;
  return entry;
}

export async function submitPubNameCorrection(
  entry: PubNameCorrectionEntry,
  signal?: AbortSignal,
): Promise<SubmitPubNameCorrectionResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint('/v1/pub-name-corrections');
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
        source: 'pub_name_correction_submit',
        endpoint: '/v1/pub-name-corrections',
      });
      return 'retry';
    }
    if (!resp.ok) {
      const result: SubmitPubNameCorrectionResult =
        resp.status === 400 || resp.status === 422 ? 'permanent-error' : 'retry';
      trackApiFailure('pub_name_correction_submit', {
        endpoint: '/v1/pub-name-corrections',
        status: resp.status,
        sync_result: result,
        retryable: result === 'retry',
      });
      return result;
    }
    return 'ok';
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure('pub_name_correction_submit', {
        endpoint: '/v1/pub-name-corrections',
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
