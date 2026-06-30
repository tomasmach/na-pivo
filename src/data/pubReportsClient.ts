/**
 * Pub report client — lets users hide places that are closed or not pubs.
 *
 * Reporting is best-effort. The app always hides the place locally first; this
 * client only syncs the report to the backend so future searches can filter it.
 */

import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import type { Pub } from './pubs';

export type PubReportReason = 'closed' | 'not_pub';

export interface BlockedPubReport {
  cacheKey: string;
  externalId: string | null;
  reason: PubReportReason;
}

interface BackendBlockedReport {
  cache_key?: string;
  external_id?: string | null;
  reason?: string;
}

interface BackendBlockedResponse {
  blocked?: BackendBlockedReport[];
}

const REQUEST_TIMEOUT_MS = 8000;
const VALID_REASONS = new Set<string>(['closed', 'not_pub']);

export async function reportPubIssue(
  pub: Pub,
  reason: PubReportReason,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;

  const endpoint = getBackendEndpoint('/v1/pub-reports');
  if (!endpoint) return false;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return false;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        city: pub.city,
        address: pub.address,
        external_id: pub.id,
        reason,
      }),
      signal: abort.signal,
    });

    return resp.ok;
  } catch {
    return false;
  } finally {
    abort.cleanup();
  }
}

export async function fetchBlockedPubReports(
  lat: number,
  lng: number,
  radiusKm: number,
  signal?: AbortSignal,
): Promise<BlockedPubReport[]> {
  if (signal?.aborted) return [];

  const endpoint = getBackendEndpoint('/v1/pub-reports/blocked');
  if (!endpoint) return [];

  const url = new URL(endpoint);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radius_km', String(radiusKm));

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      method: 'GET',
      signal: abort.signal,
    });
    if (!resp.ok) return [];

    const data = (await resp.json()) as BackendBlockedResponse;
    const blocked = Array.isArray(data?.blocked) ? data.blocked : [];
    return blocked.flatMap((entry) => {
      if (!entry?.cache_key || !VALID_REASONS.has(entry.reason ?? '')) return [];
      return [{
        cacheKey: entry.cache_key,
        externalId: entry.external_id ?? null,
        reason: entry.reason as PubReportReason,
      }];
    });
  } catch {
    return [];
  } finally {
    abort.cleanup();
  }
}
