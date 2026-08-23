import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';
import { notifyUgcConsentRequiredFromResponse, ugcPolicyHeaders } from './ugcConsent';

export interface PubEvent {
  id: string;
  title: string;
  details: string;
  startsAt: string;
  endsAt: string;
  verifiedAt: string;
}

interface WirePubEvent {
  id?: unknown;
  title?: unknown;
  details?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  verified_at?: unknown;
}

export interface PubEventSuggestion {
  clientId: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  externalId?: string | null;
  title: string;
  details?: string;
  startsAt: string;
  endsAt: string;
}

export type SubmitPubEventResult = 'ok' | 'auth-required' | 'permanent-error' | 'retry';

const REQUEST_TIMEOUT_MS = 8000;

function parseEvent(value: WirePubEvent): PubEvent | null {
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.details !== 'string' ||
    typeof value.starts_at !== 'string' ||
    typeof value.ends_at !== 'string' ||
    typeof value.verified_at !== 'string'
  ) {
    return null;
  }
  const startsAt = Date.parse(value.starts_at);
  const endsAt = Date.parse(value.ends_at);
  const verifiedAt = Date.parse(value.verified_at);
  if (![startsAt, endsAt, verifiedAt].every(Number.isFinite)) return null;
  return {
    id: value.id,
    title: value.title,
    details: value.details,
    startsAt: value.starts_at,
    endsAt: value.ends_at,
    verifiedAt: value.verified_at,
  };
}

export function isPubEventActive(event: PubEvent, now = Date.now()): boolean {
  return Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) > now;
}

export async function fetchActivePubEvents(
  pubKey: string,
  signal?: AbortSignal,
): Promise<PubEvent[] | null> {
  const endpoint = getBackendEndpoint(`/v1/pub-events?cache_key=${encodeURIComponent(pubKey)}`);
  if (!endpoint || signal?.aborted) return null;

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { signal: abort.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as { events?: unknown };
    if (!Array.isArray(body.events)) return null;
    return body.events
      .map((event) => parseEvent(event as WirePubEvent))
      .filter((event): event is PubEvent => event != null)
      .filter((event) => isPubEventActive(event));
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}

export async function submitPubEventSuggestion(
  suggestion: PubEventSuggestion,
  signal?: AbortSignal,
): Promise<SubmitPubEventResult> {
  const endpoint = getBackendEndpoint('/v1/pub-events');
  if (!endpoint || signal?.aborted) return 'retry';

  const session = await ensureAccount(signal);
  if (!session?.authenticated) return 'auth-required';

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        ...ugcPolicyHeaders(session.accountId),
      },
      body: JSON.stringify({
        client_id: suggestion.clientId,
        name: suggestion.name,
        lat: suggestion.lat,
        lng: suggestion.lng,
        city: suggestion.city ?? '',
        external_id: suggestion.externalId ?? '',
        title: suggestion.title,
        details: suggestion.details ?? '',
        starts_at: suggestion.startsAt,
        ends_at: suggestion.endsAt,
      }),
      signal: abort.signal,
    });
    if (response.ok) return 'ok';
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    notifyUgcConsentRequiredFromResponse(response.status, payload);
    if (response.status === 401 || response.status === 403) {
      if (response.status === 401) {
        await clearCachedAnonymousAccount(session, {
          source: 'pub_event_submit',
          endpoint: '/v1/pub-events',
        });
      }
      return 'auth-required';
    }
    if (response.status === 400 || response.status === 422) return 'permanent-error';
    return 'retry';
  } catch {
    return 'retry';
  } finally {
    abort.cleanup();
  }
}
