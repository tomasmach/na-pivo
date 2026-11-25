/**
 * What earned the account its XP lately (GET /v1/account/me/xp-events), for the
 * level-up sheet. Never throws: null means offline, no account or an older
 * backend, and the sheet then just leaves the list out.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';

const REQUEST_TIMEOUT_MS = 8000;
const PATH = '/v1/account/me/xp-events';

export type XpEventReason = 'drink' | 'photo' | 'checkin' | 'mapping' | 'community' | 'contest';

export interface XpEvent {
  reason: XpEventReason;
  amount: number;
  cacheKey: string;
  pubName: string;
  createdAt: string;
}

const REASONS: readonly string[] = ['drink', 'photo', 'checkin', 'mapping', 'community', 'contest'];

function parseEvent(raw: unknown): XpEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.reason !== 'string' || !REASONS.includes(row.reason)) return null;
  if (typeof row.amount !== 'number' || !(row.amount > 0)) return null;
  return {
    reason: row.reason as XpEventReason,
    amount: row.amount,
    cacheKey: typeof row.cache_key === 'string' ? row.cache_key : '',
    pubName: typeof row.pub_name === 'string' ? row.pub_name : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

export async function fetchXpEvents(since?: string | null, signal?: AbortSignal): Promise<XpEvent[] | null> {
  const base = getBackendEndpoint(PATH);
  if (!base || signal?.aborted) return null;
  const endpoint = since ? `${base}${base.includes('?') ? '&' : '?'}since=${encodeURIComponent(since)}` : base;

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
      await clearCachedAnonymousAccount(session, { source: 'xp_events_fetch', endpoint: PATH });
      return null;
    }
    if (!resp.ok) return null;
    const body = (await resp.json()) as { events?: unknown } | null;
    if (!Array.isArray(body?.events)) return null;
    return body.events.map(parseEvent).filter((event): event is XpEvent => event !== null);
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}
