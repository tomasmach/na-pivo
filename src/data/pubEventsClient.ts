import { clearCachedAnonymousAccount, ensureAccount } from './account';
import { chainAbortSignal } from './apiFetch';
import { getBackendEndpoint } from './backendConfig';

export interface PubEvent {
  id: string;
  title: string;
  details: string;
  startsAt: string;
  endsAt: string;
  verifiedAt: string;
  /** The pub the event was suggested for; older backends leave it out. */
  pubName?: string;
  pubExternalId?: string;
}

interface WirePubEvent {
  id?: unknown;
  title?: unknown;
  details?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  verified_at?: unknown;
  pub_name?: unknown;
  pub_external_id?: unknown;
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
    ...(typeof value.pub_name === 'string' && value.pub_name ? { pubName: value.pub_name } : {}),
    ...(typeof value.pub_external_id === 'string' && value.pub_external_id
      ? { pubExternalId: value.pub_external_id }
      : {}),
  };
}

export function isPubEventActive(event: PubEvent, now = Date.now()): boolean {
  return Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) > now;
}

async function fetchPubEvents(
  path: string,
  keep: (event: PubEvent) => boolean,
  signal?: AbortSignal,
): Promise<PubEvent[] | null> {
  const endpoint = getBackendEndpoint(path);
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
      .filter(keep);
  } catch {
    return null;
  } finally {
    abort.cleanup();
  }
}

export async function fetchActivePubEvents(
  pubKey: string,
  signal?: AbortSignal,
): Promise<PubEvent[] | null> {
  return fetchPubEvents(
    `/v1/pub-events?cache_key=${encodeURIComponent(pubKey)}`,
    (event) => isPubEventActive(event),
    signal,
  );
}

/**
 * Verified events that have not ended and start within two weeks, soonest
 * first. A backend without the `window` parameter answers with the running
 * events only, which is still a correct subset.
 */
export async function fetchUpcomingPubEvents(
  pubKey: string,
  signal?: AbortSignal,
): Promise<PubEvent[] | null> {
  const events = await fetchPubEvents(
    `/v1/pub-events?cache_key=${encodeURIComponent(pubKey)}&window=upcoming`,
    (event) => Date.parse(event.endsAt) > Date.now(),
    signal,
  );
  return events?.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) ?? null;
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
