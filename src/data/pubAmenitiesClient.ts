/**
 * "Zmapuj hospodu" amenities sync client — pushes per-amenity community votes to
 * the backend, pulls the account's own votes back down, fetches public aggregates
 * for visible pubs, and fetches the taxonomy overlay.
 *
 * Same conventions as pubRatingsClient: best-effort Bearer requests with an 8s
 * timeout that NEVER throw. Delivery guarantees live in pubAmenitiesQueue.ts
 * (persist-before-send + retry on launch/foreground). Restore/merge lives in
 * pubAmenitiesSync.ts.
 *
 * Unlike a private rating, an amenity vote is a PUBLIC contribution: the backend
 * folds every user's votes into a per-pub, per-amenity aggregate shown to
 * everyone and powering a future map filter. The vote itself is still per-account
 * (Bearer) and stays the user's own to edit/retract. lat/lng ride only in the
 * user-triggered PUT body and are NEVER logged; the backend re-derives the
 * geohash-8 cache_key from them.
 *
 * Wire format is snake_case; the store speaks camelCase and the sync layer maps
 * between the two. submitAmenityVotes returns the SAME three-state result the
 * ratings queue uses to decide keep/drop:
 *   - 'ok'              → 2xx: reached the backend, drop from queue.
 *   - 'permanent-error' → 400/422: this byte-stable payload will never succeed.
 *   - 'retry'           → network/timeout/5xx/429/401/dormant: keep + retry.
 *
 * The read sides (fetchMyAmenityVotes / fetchPubAmenities / getAmenityKinds)
 * return the parsed value or null on ANY failure (never throw).
 */

import { clearCachedAnonymousAccount, ensureAccount, type AccountSession } from './account';
import { getBackendEndpoint } from './backendConfig';
import { trackClientEvent } from './telemetryClient';

/** Taxonomy item from GET /v1/pub-amenities/kinds (canonical wire names). */
export interface WireAmenityKind {
  key: string;
  /** payment | seating | games | atmosphere | practical */
  group: string;
  label_cs: string;
  short_label_cs: string;
  /** IconGlyph export name. */
  icon: string;
  map_filterable: boolean;
  is_active: boolean;
  order: number;
}

/**
 * One PUT body row (the whole body is wrapped: { votes: [ WireAmenityVote, ... ] }).
 * cache_key is re-derived server-side from lat/lng (never sent). One amenity per row.
 */
export interface WireAmenityVote {
  name?: string;
  lat: number;
  lng: number;
  city?: string;
  external_id?: string | null;
  amenity_key: string;
  /** 'yes' | 'no' | null — null = clear/tombstone. */
  value: 'yes' | 'no' | null;
  taxonomy_version?: number;
  /** ISO-8601 — server-side per-amenity last-write-wins key. */
  client_updated_at: string;
}

/** One amenity's public truth for one pub. */
export interface WireAmenityAggregate {
  amenity_key: string;
  /** The aggregated verdict. */
  status: 'yes' | 'no' | 'disputed' | 'unknown';
  /** 0..1 (wire-rounded to 2 dp). */
  confidence: number;
  yes_count: number;
  no_count: number;
  /** distinct accounts with a live vote here. */
  distinct_voter_count: number;
  /** caller's own vote, exact overlay (no +1 heuristic); null/omitted when anon. */
  my_value?: 'yes' | 'no' | null;
}

/** One PUT response item (the whole response is { results: [...], mapper }). */
export interface WireAmenityVoteResponse {
  /** false = stale write rejected by server LWW OR ignored-unknown (still 'ok' for queue). */
  applied: boolean;
  /** true only when amenity_key was not a known active kind. */
  ignored_unknown_amenity: boolean;
  /** true on a retraction (value:null) that removed the user's row. */
  deleted: boolean;
  /** true only when this write created the very first vote for (pub, amenity). */
  was_first_map: boolean;
  /** authoritative per-vote award (0 on flip/re-vote/retract). */
  xp_awarded: number;
  /** null on retract/ignore; lat/lng never echoed. */
  vote: { amenity_key: string; value: 'yes' | 'no'; client_updated_at: string } | null;
  /** recomputed aggregate, lets the meter/XP update in one round-trip. */
  aggregate: WireAmenityAggregate | null;
}

/** Per-pub mapper completeness, nested in WirePubAmenities. */
export interface WireAmenityCompleteness {
  /** distinct ACTIVE amenities with status != 'unknown'. */
  mapped_count: number;
  /** active amenity count (server-authoritative denominator). */
  total_kinds: number;
  /** mapped_count / total_kinds, 0..1, clamped. */
  pct: number;
}

/** Full mapped-state of one pub (aggregates batch read item). */
export interface WirePubAmenities {
  cache_key: string;
  /** distinct accounts who voted any amenity at this pub. */
  mapper_count: number;
  completeness: WireAmenityCompleteness;
  amenities: WireAmenityAggregate[];
}

/** The account's own votes, for cross-device restore. */
export interface WireMyAmenityVote {
  cache_key: string;
  pub_identity_key?: string;
  name?: string;
  amenity_key: string;
  value: 'yes' | 'no' | null;
  client_updated_at: string;
}

/** One level rung of the Mapér ladder (server copy of the locked table). */
export interface WireMapperLevel {
  level: number;
  title: string;
  xp: number;
}

/** Env-default XP constants, exposed so the optimistic toast estimates from a
 *  shared source of truth instead of a hardcoded guess. */
export interface WireMapperXpRules {
  first_fact: number;
  first_mapper_bonus: number;
  confirm: number;
  pub_complete_bonus: number;
}

/** The full Mapér block — returned ONLY on GET /v1/account/me. */
export interface WireMapper {
  /** Durable XP total — `xp`, NOT `mapper_xp`. */
  xp: number;
  level: number;
  title: string;
  xp_into_level: number;
  /** null at the top level (maper_progress returns None there). */
  xp_for_next_level: number | null;
  amenity_votes_count: number;
  distinct_mapped_pubs: number;
  first_mapper_count: number;
  completed_pubs_count: number;
  levels: WireMapperLevel[];
  xp_rules: WireMapperXpRules;
}

/**
 * The COMPACT Mapér snapshot returned at the PUT /v1/pub-amenities/votes envelope
 * level. The PUT body emits only maper_snapshot() (mapper.py) — no counters,
 * levels, or xp_rules. The full WireMapper block exists ONLY on GET /account/me.
 */
export type WireMapperSnapshot = Pick<
  WireMapper,
  'xp' | 'level' | 'title' | 'xp_into_level' | 'xp_for_next_level'
> &
  Partial<
    Pick<
      WireMapper,
      'distinct_mapped_pubs' | 'amenity_votes_count' | 'first_mapper_count' | 'completed_pubs_count'
    >
  >;

/** The full PUT /v1/pub-amenities/votes response envelope. */
export interface WireAmenityVotesResponse {
  results: WireAmenityVoteResponse[];
  /** Compact snapshot only — see WireMapperSnapshot. */
  mapper: WireMapperSnapshot | null;
}

/** Outcome of one submit attempt — drives queue keep/drop decisions. */
export type SubmitAmenityResult = 'ok' | 'permanent-error' | 'retry';

const REQUEST_TIMEOUT_MS = 8000;

type AmenityOperation = 'submit_votes' | 'fetch_votes' | 'fetch_aggregates' | 'fetch_kinds';

async function classifyAmenityHttpFailure(
  status: number,
  session: AccountSession,
): Promise<SubmitAmenityResult> {
  if (status === 401) {
    await clearCachedAnonymousAccount(session);
    return 'retry';
  }
  // Validation errors are permanent for this byte-stable payload; other 4xx can
  // be transient (auth recovery, throttling, a frontend briefly ahead of the
  // backend during rollout), so keep them queued.
  if (status === 400 || status === 422) {
    return 'permanent-error';
  }
  return 'retry';
}

function trackAmenitySynced(operation: 'submit_votes'): void {
  void trackClientEvent({
    event: 'amenity_vote_synced',
    context: { operation },
  });
}

function trackAmenitySyncFailed(
  operation: AmenityOperation,
  details: { status?: number; reason: string; result?: SubmitAmenityResult; retryable?: boolean },
): void {
  void trackClientEvent({
    event: 'amenity_vote_failed',
    severity: 'warning',
    context: {
      operation,
      status: details.status,
      reason: details.reason,
      sync_result: details.result,
      retryable: details.retryable,
    },
  });
}

/** Layer an external AbortSignal with an internal 8s timeout. */
function chainTimeout(signal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }
  return {
    signal: timeoutController.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    },
  };
}

/**
 * PUT one or more amenity votes (the body is wrapped: { votes: [...] }). Returns a
 * three-state result (see SubmitAmenityResult). Never throws. Dormant backend or
 * missing account → 'retry' so the payload stays queued; the local vote still
 * works regardless. Even though the PUT returns a results/mapper envelope, the
 * queue only cares about the keep/drop result here; the envelope is consumed by
 * the sheet/profile on the live (online) submit path elsewhere.
 */
export async function submitAmenityVotes(
  votes: WireAmenityVote[],
  signal?: AbortSignal,
): Promise<SubmitAmenityResult> {
  if (signal?.aborted) return 'retry';

  const endpoint = getBackendEndpoint('/v1/pub-amenities/votes');
  if (!endpoint) {
    trackAmenitySyncFailed('submit_votes', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackAmenitySyncFailed('submit_votes', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  }

  const abort = chainTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ votes }),
      signal: abort.signal,
    });

    if (resp.ok) {
      trackAmenitySynced('submit_votes');
      return 'ok';
    }
    const result = await classifyAmenityHttpFailure(resp.status, session);
    trackAmenitySyncFailed('submit_votes', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return result;
  } catch {
    trackAmenitySyncFailed('submit_votes', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return 'retry';
  } finally {
    abort.cleanup();
  }
}

/**
 * The detailed outcome of an ONLINE submit, for the sheet's live vote handler:
 * the three-state result plus the parsed envelope body (when the PUT was 2xx and
 * the body parsed). The queue keeps using `submitAmenityVotes` for its keep/drop
 * decision — this sibling does NOT change that contract; it only surfaces the
 * extra envelope (xp_awarded + mapper snapshot) the sheet needs for the instant
 * XP toast + the Profile mapper refresh. `body` is null unless `status === 'ok'`
 * and the response parsed cleanly.
 */
export interface SubmitAmenityDetailed {
  status: SubmitAmenityResult;
  body: WireAmenityVotesResponse | null;
}

function isWireMapperSnapshot(value: unknown): value is WireMapperSnapshot {
  const m = value as WireMapperSnapshot;
  return (
    !!m &&
    typeof m.xp === 'number' &&
    typeof m.level === 'number' &&
    typeof m.title === 'string'
  );
}

function isWireAmenityVoteResponse(value: unknown): value is WireAmenityVoteResponse {
  const r = value as WireAmenityVoteResponse;
  return (
    !!r &&
    typeof r.xp_awarded === 'number' &&
    typeof r.was_first_map === 'boolean' &&
    (r.aggregate === null || isWireAmenityAggregate(r.aggregate))
  );
}

function parseVotesResponse(data: unknown): WireAmenityVotesResponse | null {
  const d = data as { results?: unknown; mapper?: unknown };
  if (!d || !Array.isArray(d.results)) return null;
  return {
    results: d.results.filter(isWireAmenityVoteResponse),
    mapper: isWireMapperSnapshot(d.mapper) ? d.mapper : null,
  };
}

/**
 * PUT one or more amenity votes and return BOTH the three-state queue result and
 * the parsed envelope (results + mapper snapshot). Same best-effort, never-throws
 * contract as submitAmenityVotes — the only difference is it reads the 2xx body.
 * The sheet uses this on the live (online) path so it can fire the instant XP
 * toast from the authoritative `xp_awarded` and feed the fresh mapper snapshot to
 * Profile in one round-trip. Offline / dormant / failure → { status:'retry', body:null }.
 */
export async function submitAmenityVotesDetailed(
  votes: WireAmenityVote[],
  signal?: AbortSignal,
): Promise<SubmitAmenityDetailed> {
  if (signal?.aborted) return { status: 'retry', body: null };

  const endpoint = getBackendEndpoint('/v1/pub-amenities/votes');
  if (!endpoint) {
    trackAmenitySyncFailed('submit_votes', {
      reason: 'backend_unconfigured',
      result: 'retry',
      retryable: true,
    });
    return { status: 'retry', body: null };
  }

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) {
    trackAmenitySyncFailed('submit_votes', {
      reason: signal?.aborted ? 'aborted' : 'account_unavailable',
      result: 'retry',
      retryable: true,
    });
    return { status: 'retry', body: null };
  }

  const abort = chainTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ votes }),
      signal: abort.signal,
    });

    if (resp.ok) {
      trackAmenitySynced('submit_votes');
      let body: WireAmenityVotesResponse | null = null;
      try {
        body = parseVotesResponse(await resp.json());
      } catch {
        body = null; // a 2xx with an unparseable body is still 'ok' for the queue.
      }
      return { status: 'ok', body };
    }
    const result = await classifyAmenityHttpFailure(resp.status, session);
    trackAmenitySyncFailed('submit_votes', {
      status: resp.status,
      reason: 'http_error',
      result,
      retryable: result === 'retry',
    });
    return { status: result, body: null };
  } catch {
    trackAmenitySyncFailed('submit_votes', {
      reason: 'network_or_timeout',
      result: 'retry',
      retryable: true,
    });
    return { status: 'retry', body: null };
  } finally {
    abort.cleanup();
  }
}

function isWireMyAmenityVote(value: unknown): value is WireMyAmenityVote {
  const v = value as WireMyAmenityVote;
  return (
    !!v &&
    typeof v.cache_key === 'string' &&
    typeof v.amenity_key === 'string' &&
    (v.value === 'yes' || v.value === 'no' || v.value === null) &&
    typeof v.client_updated_at === 'string'
  );
}

/**
 * GET the account's own amenity votes (the PULL side). Returns the parsed array,
 * or null on ANY failure (dormant backend, no account, network/timeout, non-2xx,
 * malformed body). Never throws. Parses the { votes: [...] } wrapper.
 */
export async function fetchMyAmenityVotes(signal?: AbortSignal): Promise<WireMyAmenityVote[] | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/pub-amenities/votes');
  if (!endpoint) return null;

  const session = await ensureAccount(signal);
  if (!session || signal?.aborted) return null;

  const abort = chainTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session);
      return null;
    }
    if (!resp.ok) {
      trackAmenitySyncFailed('fetch_votes', {
        status: resp.status,
        reason: 'http_error',
        retryable: true,
      });
      return null;
    }

    const data = (await resp.json()) as { votes?: unknown };
    if (!data || !Array.isArray(data.votes)) return null;
    return data.votes.filter(isWireMyAmenityVote);
  } catch {
    trackAmenitySyncFailed('fetch_votes', {
      reason: 'network_or_timeout',
      retryable: true,
    });
    return null;
  } finally {
    abort.cleanup();
  }
}

function isWireAmenityAggregate(value: unknown): value is WireAmenityAggregate {
  const a = value as WireAmenityAggregate;
  return (
    !!a &&
    typeof a.amenity_key === 'string' &&
    typeof a.yes_count === 'number' &&
    typeof a.no_count === 'number'
  );
}

function isWirePubAmenities(value: unknown): value is WirePubAmenities {
  const p = value as WirePubAmenities;
  return !!p && typeof p.cache_key === 'string' && Array.isArray(p.amenities);
}

/**
 * GET public amenity aggregates for a batch of pubs (AllowAny). Pass the cache_keys
 * (= local pubKeys). Returns the parsed array, or null on ANY failure. Never
 * throws. Parses the { pubs: [...] } wrapper. This is a separate cheap read with
 * its own short TTL — it does NOT bolt onto the Mapy-cached /v1/pubs/near.
 */
export async function fetchPubAmenities(
  cacheKeys: string[],
  signal?: AbortSignal,
  name?: string,
): Promise<WirePubAmenities[] | null> {
  if (signal?.aborted) return null;
  const keys = cacheKeys.filter((k) => typeof k === 'string' && k.length > 0);
  if (keys.length === 0) return [];

  const query = keys.map((k) => encodeURIComponent(k)).join(',');
  const nameQuery = name ? `&name=${encodeURIComponent(name)}` : '';
  const endpoint = getBackendEndpoint(`/v1/pub-amenities?cache_keys=${query}${nameQuery}`);
  if (!endpoint) return null;

  // Aggregates are AllowAny, but we still attach a Bearer when we have one so the
  // server can fill in my_value for the caller's own votes.
  const session = await ensureAccount(signal);
  if (signal?.aborted) return null;

  const abort = chainTimeout(signal);
  try {
    const headers: Record<string, string> = {};
    if (session) headers.Authorization = `Bearer ${session.token}`;
    const resp = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: abort.signal,
    });

    if (resp.status === 401) {
      await clearCachedAnonymousAccount(session);
      return null;
    }
    if (!resp.ok) {
      trackAmenitySyncFailed('fetch_aggregates', {
        status: resp.status,
        reason: 'http_error',
        retryable: true,
      });
      return null;
    }

    const data = (await resp.json()) as { pubs?: unknown };
    if (!data || !Array.isArray(data.pubs)) return null;
    return data.pubs.filter(isWirePubAmenities).map((pub) => ({
      ...pub,
      amenities: pub.amenities.filter(isWireAmenityAggregate),
    }));
  } catch {
    trackAmenitySyncFailed('fetch_aggregates', {
      reason: 'network_or_timeout',
      retryable: true,
    });
    return null;
  } finally {
    abort.cleanup();
  }
}

function isWireAmenityKind(value: unknown): value is WireAmenityKind {
  const k = value as WireAmenityKind;
  return !!k && typeof k.key === 'string' && typeof k.group === 'string';
}

/**
 * GET the taxonomy overlay (AllowAny, cacheable). Returns the parsed array, or
 * null on ANY failure. Never throws. The catalogue in amenities.ts stays
 * authoritative for rendering; this is a forward-compat overlay only.
 */
export async function getAmenityKinds(signal?: AbortSignal): Promise<WireAmenityKind[] | null> {
  if (signal?.aborted) return null;

  const endpoint = getBackendEndpoint('/v1/pub-amenities/kinds');
  if (!endpoint) return null;

  const abort = chainTimeout(signal);
  try {
    const resp = await fetch(endpoint, {
      method: 'GET',
      signal: abort.signal,
    });

    if (!resp.ok) {
      trackAmenitySyncFailed('fetch_kinds', {
        status: resp.status,
        reason: 'http_error',
        retryable: true,
      });
      return null;
    }

    const data = (await resp.json()) as { kinds?: unknown };
    if (!data || !Array.isArray(data.kinds)) return null;
    return data.kinds.filter(isWireAmenityKind);
  } catch {
    trackAmenitySyncFailed('fetch_kinds', {
      reason: 'network_or_timeout',
      retryable: true,
    });
    return null;
  } finally {
    abort.cleanup();
  }
}
