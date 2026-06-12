/**
 * "What's new" release-notes client.
 *
 * Design principle (identical to hoursClient / account): talking to the backend
 * is a NON-BLOCKING enrichment. If EXPO_PUBLIC_BACKEND_URL is unset/empty or the
 * request fails/times out, this module resolves gracefully and NEVER throws.
 *
 * The result is a three-way discriminated union so the caller can tell apart:
 *  - 'note'  — a published note exists for this version → show it once.
 *  - 'none'  — the backend definitively has nothing (HTTP 404 or empty note) →
 *              advance the seen-baseline so we stop asking for this version.
 *  - 'error' — dormant / offline / timeout / malformed → leave the baseline
 *              untouched so the check retries on the next launch.
 */

import Constants from 'expo-constants';

import { getBackendEndpoint } from './backendConfig';

export interface ReleaseNoteItem {
  /** Optional leading emoji (may be ''). */
  icon: string;
  text: string;
}

export interface ReleaseNote {
  version: string;
  title: string;
  items: ReleaseNoteItem[];
}

export type FetchReleaseNoteResult =
  | { kind: 'note'; note: ReleaseNote }
  | { kind: 'none' }
  | { kind: 'error' };

const REQUEST_TIMEOUT_MS = 8000;

/** The version of the currently-running build, or null if unavailable. */
export function getCurrentAppVersion(): string | null {
  return Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? null;
}

function normalizeItems(raw: unknown): ReleaseNoteItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ReleaseNoteItem[] = [];
  for (const entry of raw) {
    const text = (entry as { text?: unknown })?.text;
    if (typeof text !== 'string' || text.length === 0) continue;
    const icon = (entry as { icon?: unknown })?.icon;
    out.push({ icon: typeof icon === 'string' ? icon : '', text });
  }
  return out;
}

/**
 * Fetch the published "what's new" note for `version`.
 *
 * Always resolves; never throws. See FetchReleaseNoteResult for the contract.
 *
 * @param signal Optional caller AbortSignal, layered with an internal 8s timeout.
 */
export async function fetchReleaseNote(
  version: string,
  signal?: AbortSignal,
): Promise<FetchReleaseNoteResult> {
  const endpoint = getBackendEndpoint('/v1/release-notes');
  if (!endpoint || !version || signal?.aborted) {
    // Dormant (no backend) or cancelled — treat as a transient miss so the
    // caller doesn't burn the popup; it will retry next launch.
    return { kind: 'error' };
  }

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

  try {
    const url = new URL(endpoint);
    url.searchParams.set('version', version);

    const resp = await fetch(url.toString(), {
      method: 'GET',
      signal: timeoutController.signal,
    });

    // 404 is an expected, definitive "no note for this version".
    if (resp.status === 404) {
      return { kind: 'none' };
    }
    if (!resp.ok) {
      return { kind: 'error' };
    }

    const data = (await resp.json()) as Partial<ReleaseNote>;
    const items = normalizeItems(data?.items);

    // A note with no usable highlights is nothing worth interrupting the user
    // for — treat it as 'none' so we advance past this version.
    if (typeof data?.version !== 'string' || !data.version || items.length === 0) {
      return { kind: 'none' };
    }

    return {
      kind: 'note',
      note: {
        version: data.version,
        title: typeof data.title === 'string' && data.title ? data.title : 'Co je nového',
        items,
      },
    };
  } catch {
    // network / timeout / abort / malformed JSON — never throw.
    return { kind: 'error' };
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
