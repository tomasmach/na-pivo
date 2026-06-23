/**
 * Tests for the amenities sync client (src/data/pubAmenitiesClient.ts) — the
 * data/logic layer only. Collaborators are mocked so each test is deterministic
 * and never touches the network or native modules.
 */

import {
  submitAmenityVotes,
  fetchMyAmenityVotes,
  fetchPubAmenities,
  getAmenityKinds,
  type WireAmenityVote,
} from '../pubAmenitiesClient';
import { clearCachedAnonymousAccount, ensureAccount } from '../account';
import { getBackendEndpoint } from '../backendConfig';

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'anon-tok',
    authenticated: false,
  })),
  clearCachedAnonymousAccount: jest.fn(async () => true),
}));

jest.mock('../telemetryClient', () => ({
  trackClientEvent: jest.fn(async () => undefined),
}));

const mockGetBackendEndpoint = getBackendEndpoint as jest.MockedFunction<typeof getBackendEndpoint>;
const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const mockClearAnon = clearCachedAnonymousAccount as jest.MockedFunction<
  typeof clearCachedAnonymousAccount
>;

const ORIGINAL_FETCH = global.fetch;

function fetchResolving(status: number, body: unknown): jest.Mock {
  const ok = status >= 200 && status < 300;
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

function installFetch(fn: jest.Mock): jest.Mock {
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function vote(over: Partial<WireAmenityVote> = {}): WireAmenityVote {
  return {
    name: 'U Testu',
    lat: 50.08,
    lng: 14.42,
    amenity_key: 'game_darts',
    value: 'yes',
    taxonomy_version: 1,
    client_updated_at: '2026-06-14T19:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBackendEndpoint.mockImplementation((path: string) => `https://api.test${path}`);
  mockEnsureAccount.mockResolvedValue({ deviceId: 'd', accountId: 'a', token: 'anon-tok', authenticated: false });
  mockClearAnon.mockResolvedValue(true);
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('submitAmenityVotes — wire mapping + three-state classification', () => {
  it("PUTs a { votes: [...] } wrapper with a Bearer token and returns 'ok' on 2xx", async () => {
    const spy = installFetch(fetchResolving(200, { results: [], mapper: null }));
    const result = await submitAmenityVotes([vote()]);

    expect(result).toBe('ok');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/pub-amenities/votes');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer anon-tok');
    expect(JSON.parse(init.body as string)).toEqual({ votes: [vote()] });
  });

  it("returns 'permanent-error' on 400 and 422", async () => {
    installFetch(fetchResolving(400, {}));
    expect(await submitAmenityVotes([vote()])).toBe('permanent-error');
    installFetch(fetchResolving(422, {}));
    expect(await submitAmenityVotes([vote()])).toBe('permanent-error');
  });

  it("returns 'retry' on 5xx and 429", async () => {
    installFetch(fetchResolving(500, {}));
    expect(await submitAmenityVotes([vote()])).toBe('retry');
    installFetch(fetchResolving(429, {}));
    expect(await submitAmenityVotes([vote()])).toBe('retry');
  });

  it("clears the anonymous account and returns 'retry' on 401", async () => {
    installFetch(fetchResolving(401, {}));
    const result = await submitAmenityVotes([vote()]);
    expect(result).toBe('retry');
    expect(mockClearAnon).toHaveBeenCalledTimes(1);
  });

  it("returns 'retry' when fetch rejects (network/timeout)", async () => {
    installFetch(jest.fn().mockRejectedValue(new Error('offline')));
    expect(await submitAmenityVotes([vote()])).toBe('retry');
  });

  it("returns 'retry' when the backend is dormant and never fetches", async () => {
    mockGetBackendEndpoint.mockReturnValue(null);
    const spy = installFetch(fetchResolving(200, {}));
    expect(await submitAmenityVotes([vote()])).toBe('retry');
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns 'retry' when no account is available", async () => {
    mockEnsureAccount.mockResolvedValue(null);
    const spy = installFetch(fetchResolving(200, {}));
    expect(await submitAmenityVotes([vote()])).toBe('retry');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fetchMyAmenityVotes — parses the { votes: [...] } wrapper', () => {
  it('returns the parsed votes, filtering malformed rows', async () => {
    installFetch(
      fetchResolving(200, {
        votes: [
          { cache_key: 'aaaaaaaa', amenity_key: 'game_darts', value: 'yes', client_updated_at: 't' },
          { cache_key: 'bbbbbbbb', amenity_key: 'practical_wifi', value: 'maybe', client_updated_at: 't' },
          { nope: true },
        ],
      }),
    );
    const result = await fetchMyAmenityVotes();
    expect(result).toEqual([
      { cache_key: 'aaaaaaaa', amenity_key: 'game_darts', value: 'yes', client_updated_at: 't' },
    ]);
  });

  it('returns null on a non-2xx', async () => {
    installFetch(fetchResolving(500, {}));
    expect(await fetchMyAmenityVotes()).toBeNull();
  });

  it('returns null when the body is not a votes array', async () => {
    installFetch(fetchResolving(200, { nope: true }));
    expect(await fetchMyAmenityVotes()).toBeNull();
  });

  it('returns null when the backend is dormant', async () => {
    mockGetBackendEndpoint.mockReturnValue(null);
    expect(await fetchMyAmenityVotes()).toBeNull();
  });
});

describe('fetchPubAmenities — batch aggregates', () => {
  it('encodes cache_keys, parses the { pubs: [...] } wrapper, and attaches a Bearer', async () => {
    const spy = installFetch(
      fetchResolving(200, {
        pubs: [
          {
            cache_key: 'aaaaaaaa',
            mapper_count: 3,
            completeness: { mapped_count: 5, total_kinds: 16, pct: 0.31 },
            amenities: [
              { amenity_key: 'game_darts', status: 'yes', confidence: 0.8, yes_count: 4, no_count: 0, distinct_voter_count: 4, my_value: 'yes' },
            ],
          },
        ],
      }),
    );
    const result = await fetchPubAmenities(['aaaaaaaa', 'bbbbbbbb']);
    expect(result?.[0].completeness.total_kinds).toBe(16);
    expect(result?.[0].amenities[0].my_value).toBe('yes');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/pub-amenities?cache_keys=aaaaaaaa,bbbbbbbb');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer anon-tok');
  });

  it('short-circuits to [] for an empty key list without fetching', async () => {
    const spy = installFetch(fetchResolving(200, {}));
    expect(await fetchPubAmenities([])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null on a non-2xx', async () => {
    installFetch(fetchResolving(503, {}));
    expect(await fetchPubAmenities(['aaaaaaaa'])).toBeNull();
  });
});

describe('getAmenityKinds — taxonomy overlay', () => {
  it('parses the { kinds: [...] } wrapper without requiring auth', async () => {
    const spy = installFetch(
      fetchResolving(200, {
        kinds: [
          { key: 'game_darts', group: 'games', label_cs: 'Šipky', short_label_cs: 'Šipky', icon: 'TargetIcon', map_filterable: true, is_active: true, order: 60 },
        ],
      }),
    );
    const result = await getAmenityKinds();
    expect(result?.[0].key).toBe('game_darts');

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    // No Bearer required for the public taxonomy.
    expect(init.headers).toBeUndefined();
  });

  it('returns null on a non-2xx', async () => {
    installFetch(fetchResolving(500, {}));
    expect(await getAmenityKinds()).toBeNull();
  });
});
