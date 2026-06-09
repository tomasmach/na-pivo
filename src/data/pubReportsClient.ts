/**
 * Pub report client — lets users hide places that are closed or not pubs.
 *
 * Reporting is best-effort. The app always hides the place locally first; this
 * client only syncs the report to the backend so future searches can filter it.
 */

import { ensureAccount } from './account';
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

function getBackendUrl(): string {
  return (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

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

export async function reportPubIssue(
  pub: Pub,
  reason: PubReportReason,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;

  const baseUrl = getBackendUrl();
  if (!baseUrl) return false;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return false;

  const abort = chainAbortSignal(signal);
  try {
    const resp = await fetch(`${trimTrailingSlash(baseUrl)}/v1/pub-reports`, {
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

  const baseUrl = getBackendUrl();
  if (!baseUrl) return [];

  const url = new URL(`${trimTrailingSlash(baseUrl)}/v1/pub-reports/blocked`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radius_km', String(radiusKm));

  const abort = chainAbortSignal(signal);
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
