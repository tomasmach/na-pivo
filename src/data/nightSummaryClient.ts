/**
 * What one night brought (GET /v1/account/me/night-summary?day=YYYY-MM-DD), for
 * the receipt after "Dopito". Never throws: null means offline, no account or an
 * older backend, and the receipt then just leaves XP and the badge out.
 */

import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { parseBadgeProgress, type BadgeProgress, type RawBadgeProgress } from './achievements';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';

const REQUEST_TIMEOUT_MS = 8000;
const PATH = '/v1/account/me/night-summary';

export interface NightSummary {
  xp: number;
  badgesBefore: BadgeProgress;
  badgesAfter: BadgeProgress;
}

export async function fetchNightSummary(day: string, signal?: AbortSignal): Promise<NightSummary | null> {
  const base = getBackendEndpoint(PATH);
  if (!base || signal?.aborted) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}${base.includes('?') ? '&' : '?'}day=${encodeURIComponent(day)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });
    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session, { source: 'night_summary_fetch', endpoint: PATH });
      return null;
    }
    if (!resp.ok) return null;
    const body = (await resp.json()) as Record<string, unknown> | null;
    if (!body || typeof body.xp !== 'number' || !body.badge_progress || !body.badge_progress_before) return null;
    return {
      xp: Math.max(0, Math.round(body.xp)),
      badgesBefore: parseBadgeProgress(body.badge_progress_before as RawBadgeProgress),
      badgesAfter: parseBadgeProgress(body.badge_progress as RawBadgeProgress),
    };
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}
