/**
 * Tests for the beer-checkins client (src/data/beerCheckinsClient.ts) — the
 * data/logic layer only. Collaborators are mocked so each test is deterministic
 * and never touches the network or native modules:
 *  - backendConfig.getBackendEndpoint → 'https://api.test' + path (overridable to
 *    null to exercise the dormant-endpoint path).
 *  - account.ensureAccount → a fake session so we can assert the bearer token.
 *  - telemetryClient.trackApiFailure → a spy (never fires in the happy paths).
 *
 * Focus: the new "Pivo jako identita" surface — tag wire mapping + whitelist
 * parsing (tolerant of unknown values from a newer server), fetchBeerMemory
 * fallbacks (offline / malformed → never throws), and detail my_tags parsing.
 */

import {
  BEER_TAGS,
  beerCheckInWire,
  fetchBeerDetail,
  fetchBeerMemory,
  isBeerTag,
  parseBeerCheckIn,
  parseBeerTagCounts,
  parseBeerTags,
  type BeerCheckInInput,
} from '@/data/beerCheckinsClient';
import { getBackendEndpoint } from '@/data/backendConfig';

jest.mock('@/data/backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));

jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'cur-tok',
    authenticated: false,
  })),
  clearCachedAnonymousAccount: jest.fn(),
}));

jest.mock('@/data/telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const mockGetBackendEndpoint = getBackendEndpoint as jest.MockedFunction<typeof getBackendEndpoint>;
const ORIGINAL_FETCH = global.fetch;

/** Resolve global.fetch like the WinterCG fetch: text() then JSON.parse. */
function fetchResolving(status: number, body: unknown, ok = status >= 200 && status < 300): jest.Mock {
  const spy = jest.fn(async () => ({
    ok,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }));
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBackendEndpoint.mockImplementation((path: string) => `https://api.test${path}`);
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

const baseInput: BeerCheckInInput = {
  clientId: 'c1',
  beerName: 'Radegast 12',
  visibility: 'friends',
};

describe('tag helpers', () => {
  it('ships exactly the eight contract tags', () => {
    expect(BEER_TAGS).toEqual([
      'crisp',
      'great_foam',
      'smooth',
      'watery',
      'stale',
      'overpriced',
      'one_more',
      'never_again',
    ]);
  });

  it('isBeerTag whitelists only known values', () => {
    expect(isBeerTag('crisp')).toBe(true);
    expect(isBeerTag('nope')).toBe(false);
    expect(isBeerTag(42)).toBe(false);
    expect(isBeerTag(null)).toBe(false);
  });

  it('parseBeerTags drops unknowns and de-dupes, preserving order', () => {
    expect(parseBeerTags(['crisp', 'from_the_future', 'crisp', 'one_more', 7])).toEqual([
      'crisp',
      'one_more',
    ]);
  });

  it('parseBeerTags tolerates non-arrays', () => {
    expect(parseBeerTags(undefined)).toEqual([]);
    expect(parseBeerTags(null)).toEqual([]);
    expect(parseBeerTags('crisp')).toEqual([]);
  });

  it('parseBeerTagCounts keeps only positive known-tag counts', () => {
    expect(parseBeerTagCounts({ crisp: 7, one_more: 3, bogus: 5, watery: 0, stale: -2 })).toEqual({
      crisp: 7,
      one_more: 3,
    });
    expect(parseBeerTagCounts(['crisp'])).toEqual({});
    expect(parseBeerTagCounts(null)).toEqual({});
  });
});

describe('beerCheckInWire', () => {
  it('whitelists and caps tags at three in the wire payload', () => {
    const wire = beerCheckInWire({
      ...baseInput,
      // Deliberately dirty (unknown value) — the wire mapper must whitelist it.
      tags: ['crisp', 'bogus', 'one_more', 'smooth', 'watery'] as unknown as BeerCheckInInput['tags'],
    });
    expect(wire.tags).toEqual(['crisp', 'one_more', 'smooth']);
  });

  it('defaults missing tags to an empty array', () => {
    expect(beerCheckInWire(baseInput).tags).toEqual([]);
  });

  it('ships optional end time for historical evenings', () => {
    const wire = beerCheckInWire({
      ...baseInput,
      checkedInAt: '2026-07-01T18:00:00.000Z',
      endedAt: '2026-07-01T21:30:00.000Z',
      quantity: 3,
      priceCzk: 62,
    });
    expect(wire.checked_in_at).toBe('2026-07-01T18:00:00.000Z');
    expect(wire.ended_at).toBe('2026-07-01T21:30:00.000Z');
    expect(wire.quantity).toBe(3);
    expect(wire.price_czk).toBe(62);
  });
});

describe('parseBeerCheckIn', () => {
  it('parses tags with the whitelist filter', () => {
    const parsed = parseBeerCheckIn({
      id: 'x',
      beer_name: 'Radegast 12',
      tags: ['crisp', 'unknown_from_newer_server', 'one_more'],
      ended_at: '2026-07-01T21:30:00Z',
      quantity: 3,
      price_czk: 62,
    });
    expect(parsed.tags).toEqual(['crisp', 'one_more']);
    expect(parsed.endedAt).toBe('2026-07-01T21:30:00Z');
    expect(parsed.quantity).toBe(3);
    expect(parsed.priceCzk).toBe(62);
  });

  it('defaults tags to [] when absent', () => {
    expect(parseBeerCheckIn({ id: 'x' }).tags).toEqual([]);
  });
});

describe('fetchBeerMemory', () => {
  it('maps a known-beer memory response', async () => {
    const spy = fetchResolving(200, {
      beer_name: 'Radegast 12',
      brewery_name: '',
      my_count: 12,
      first_checked_in_at: '2026-06-01T18:03:00Z',
      last_checked_in_at: '2026-07-01T19:40:00Z',
      last_pub_name: 'Lokál Dlouhá',
      last_rating: 4.0,
      my_average_rating: 4.2,
      top_tags: ['crisp', 'one_more', 'from_the_future'],
    });

    const memory = await fetchBeerMemory('Radegast 12');
    expect(memory).toEqual({
      beerName: 'Radegast 12',
      breweryName: '',
      myCount: 12,
      firstCheckedInAt: '2026-06-01T18:03:00Z',
      lastCheckedInAt: '2026-07-01T19:40:00Z',
      lastPubName: 'Lokál Dlouhá',
      lastRating: 4.0,
      myAverageRating: 4.2,
      topTags: ['crisp', 'one_more'],
    });

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/beers/memory?beer_name=Radegast%2012&brewery_name=');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('passes the brewery through and trims inputs', async () => {
    const spy = fetchResolving(200, { my_count: 0 });
    await fetchBeerMemory('  Kozel  ', '  Velké Popovice  ');
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.test/v1/beers/memory?beer_name=Kozel&brewery_name=Velk%C3%A9%20Popovice');
  });

  it('returns zeros for an unseen beer', async () => {
    fetchResolving(200, { my_count: 0, top_tags: [] });
    const memory = await fetchBeerMemory('Nikdy nepité');
    expect(memory?.myCount).toBe(0);
    expect(memory?.topTags).toEqual([]);
    expect(memory?.lastRating).toBeNull();
    expect(memory?.firstCheckedInAt).toBeNull();
  });

  it('never fetches (and returns null) for an empty beer name', async () => {
    const spy = fetchResolving(200, { my_count: 5 });
    await expect(fetchBeerMemory('   ')).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null when the endpoint is dormant (offline)', async () => {
    mockGetBackendEndpoint.mockReturnValue(null);
    const spy = fetchResolving(200, { my_count: 5 });
    await expect(fetchBeerMemory('Radegast 12')).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null on a network exception', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    await expect(fetchBeerMemory('Radegast 12')).resolves.toBeNull();
  });

  it('returns null on an HTTP error status', async () => {
    fetchResolving(500, { detail: 'nope' }, false);
    await expect(fetchBeerMemory('Radegast 12')).resolves.toBeNull();
  });

  it('tolerates a malformed body (defaults to zeros, never throws)', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'not json at all',
    })) as unknown as typeof fetch;
    const memory = await fetchBeerMemory('Radegast 12');
    expect(memory).toEqual({
      beerName: 'Radegast 12',
      breweryName: '',
      myCount: 0,
      firstCheckedInAt: null,
      lastCheckedInAt: null,
      lastPubName: '',
      lastRating: null,
      myAverageRating: null,
      topTags: [],
    });
  });
});

describe('fetchBeerDetail my_tags', () => {
  it('parses my_tags counts and check-in row tags', async () => {
    fetchResolving(200, {
      beer_name: 'Radegast 12',
      brewery_name: '',
      my_count: 10,
      my_tags: { crisp: 7, one_more: 3, junk: 2 },
      my_history: [{ id: 'h1', tags: ['crisp', 'bogus'] }],
      recent_checkins: [],
      party_drinkers: [],
    });
    const detail = await fetchBeerDetail('Radegast 12');
    expect(detail?.myTags).toEqual({ crisp: 7, one_more: 3 });
    expect(detail?.myHistory[0].tags).toEqual(['crisp']);
  });

  it('defaults my_tags to {} when absent', async () => {
    fetchResolving(200, { beer_name: 'X', my_count: 0 });
    const detail = await fetchBeerDetail('X');
    expect(detail?.myTags).toEqual({});
  });
});
