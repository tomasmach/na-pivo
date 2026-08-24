import {
  buildCommunityEntry,
  beerToWire,
  beerFromWire,
  submitPubCommunity,
  submitPubCommunityForQueue,
  type CommunityInput,
  type CommunityEntry,
} from '../communityClient';
import { clearCachedAnonymousAccount, ensureAccount } from '../account';
import { emptyWeeklyHours } from '../communityHours';
import {
  UGC_POLICY_HEADER,
  clearUgcConsentStateForTests,
  subscribeUgcConsentRequired,
} from '../ugcConsent';

// communityClient imports account → expo-secure-store, which isn't transformed
// for the node test env; mock it so the module loads (these tests exercise the
// pure mapping helpers, which never touch the secure store). jest hoists this
// above the imports above.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => true),
}));

describe('beer wire mapping', () => {
  it('maps camelCase → snake_case, dropping empty optionals', () => {
    expect(beerToWire({ name: 'Plzeň 12°', priceCzk: 65, volumeMl: 500 })).toEqual({
      name: 'Plzeň 12°',
      price_czk: 65,
      volume_ml: 500,
    });
    expect(beerToWire({ name: 'Kozel' })).toEqual({ name: 'Kozel' });
  });

  it('maps snake_case → camelCase, dropping absent optionals', () => {
    expect(beerFromWire({ name: 'Plzeň 12°', price_czk: 65, volume_ml: 500 })).toEqual({
      name: 'Plzeň 12°',
      priceCzk: 65,
      volumeMl: 500,
    });
    expect(beerFromWire({ name: 'Kozel' })).toEqual({ name: 'Kozel' });
  });
});

describe('buildCommunityEntry', () => {
  const base: CommunityInput = {
    externalId: 'mapy:50.08,14.42',
    name: 'U Testu',
    lat: 50.08,
    lng: 14.42,
    city: '  Praha  ',
  };

  it('includes the client_id and core fields, trimming city', () => {
    const entry = buildCommunityEntry(
      { ...base, hours: emptyWeeklyHours() },
      'client-1',
    );
    expect(entry.client_id).toBe('client-1');
    expect(entry.name).toBe('U Testu');
    expect(entry.lat).toBe(50.08);
    expect(entry.lng).toBe(14.42);
    expect(entry.external_id).toBe('mapy:50.08,14.42');
    expect(entry.city).toBe('Praha');
  });

  it('omits an empty city', () => {
    const entry = buildCommunityEntry(
      { ...base, city: '   ', hours: emptyWeeklyHours() },
      'c',
    );
    expect(entry.city).toBeUndefined();
  });

  it('includes only the touched sections (hours only)', () => {
    const hours = { ...emptyWeeklyHours(), mo: [['11:00', '23:00']] as [string, string][] };
    const entry = buildCommunityEntry({ ...base, hours }, 'c');
    expect(entry.hours).toEqual(hours);
    expect(entry.beers).toBeUndefined();
  });

  it('includes only the touched sections (beers only) and maps them to wire form', () => {
    const entry = buildCommunityEntry(
      { ...base, beers: [{ name: 'Plzeň', priceCzk: 60, volumeMl: 500 }] },
      'c',
    );
    expect(entry.hours).toBeUndefined();
    expect(entry.beers).toEqual([{ name: 'Plzeň', price_czk: 60, volume_ml: 500 }]);
  });

  it('maps the rotating-menu flag only when supplied', () => {
    const rotating = buildCommunityEntry(
      { ...base, beers: [{ name: 'Plzeň' }], beerMenuRotates: true },
      'c',
    );
    const legacy = buildCommunityEntry({ ...base, beers: [{ name: 'Kozel' }] }, 'd');

    expect(rotating.beer_menu_rotates).toBe(true);
    expect(legacy.beer_menu_rotates).toBeUndefined();
  });

  it('preserves a null external_id', () => {
    const entry = buildCommunityEntry(
      { ...base, externalId: null, beers: [{ name: 'X' }] },
      'c',
    );
    expect(entry.external_id).toBeNull();
  });
});

describe('submitPubCommunityForQueue wire contract', () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

  const SESSION = { deviceId: 'd', accountId: 'a', token: 't' };
  const ENTRY: CommunityEntry = {
    client_id: 'c1',
    name: 'U Testu',
    lat: 50.0812,
    lng: 14.4182,
    external_id: 'mapy:1',
  };
  const PARSED_RESPONSE = {
    cacheKey: 'k',
    hours: null,
    beers: [],
    historicalBeers: [],
    beersUpdatedAt: null,
    beerMenuRotates: false,
    xpAwarded: 0,
    mapper: null,
  };

  function setBackend(url: string | undefined): void {
    if (url === undefined) {
      delete process.env.EXPO_PUBLIC_BACKEND_URL;
    } else {
      process.env.EXPO_PUBLIC_BACKEND_URL = url;
    }
  }

  function fetchReturning(status: number, body?: unknown): jest.Mock {
    return jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })) as unknown as jest.Mock;
  }

  beforeEach(() => {
    clearUgcConsentStateForTests();
    (ensureAccount as jest.Mock).mockResolvedValue(SESSION);
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    setBackend(ORIGINAL_URL);
    jest.clearAllMocks();
  });

  it('authenticated community POST carries the canonical UGC policy header', async () => {
    setBackend('https://api.example.com');
    const spy = fetchReturning(200, { cache_key: 'k' });
    global.fetch = spy as unknown as typeof fetch;

    await submitPubCommunityForQueue(ENTRY);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/pub-community');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer t',
      [UGC_POLICY_HEADER]: '2026-08-22',
    });
  });

  it.each([400, 422])('returns permanent-error on %s', async (status) => {
    setBackend('https://api.example.com');
    global.fetch = fetchReturning(status) as unknown as typeof fetch;

    await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({
      status: 'permanent-error',
    });
  });

  it('returns retry on 401 and clears the cached anonymous account', async () => {
    setBackend('https://api.example.com');
    global.fetch = fetchReturning(401) as unknown as typeof fetch;

    await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({ status: 'retry' });

    expect(clearCachedAnonymousAccount).toHaveBeenCalledWith(SESSION, {
      source: 'pub_community_submit',
      endpoint: '/v1/pub-community',
    });
  });

  it.each(['ugc_consent_required', 'ugc_policy_update_required'])(
    'semantic 428 %s stays retry and emits exactly one consent signal',
    async (code) => {
      setBackend('https://api.example.com');
      const signals: string[] = [];
      subscribeUgcConsentRequired((event) => signals.push(event.code));
      global.fetch = fetchReturning(428, { code }) as unknown as typeof fetch;

      await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({ status: 'retry' });
      expect(signals).toEqual([code]);
    },
  );

  it.each([[{}], [{ code: 'something_else' }], [null]])(
    'malformed/bare 428 (%p) stays retry and emits no consent signal',
    async (body) => {
      setBackend('https://api.example.com');
      const signals: string[] = [];
      subscribeUgcConsentRequired((event) => signals.push(event.code));
      global.fetch = fetchReturning(428, body) as unknown as typeof fetch;

      await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({ status: 'retry' });
      expect(signals).toEqual([]);
    },
  );

  it('returns retry for throttling, server errors, and network failures', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValue(SESSION);

    for (const status of [429, 500]) {
      global.fetch = fetchReturning(status) as unknown as typeof fetch;
      await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({ status: 'retry' });
    }

    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({ status: 'retry' });
  });

  it('2xx parses the same CommunityResponse the public API exposes', async () => {
    setBackend('https://api.example.com');
    global.fetch = fetchReturning(200, { cache_key: 'k' }) as unknown as typeof fetch;

    await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({
      status: 'ok',
      response: PARSED_RESPONSE,
    });
  });

  it('public submitPubCommunity returns the parsed response on success', async () => {
    setBackend('https://api.example.com');
    global.fetch = fetchReturning(200, { cache_key: 'k' }) as unknown as typeof fetch;

    await expect(submitPubCommunity(ENTRY)).resolves.toEqual(PARSED_RESPONSE);
  });

  it('ensureAccount rejection stays retry, never throws, and never reaches fetch', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockRejectedValue(new Error('account setup failed'));
    const spy = jest.fn() as unknown as typeof fetch;
    global.fetch = spy;

    await expect(submitPubCommunityForQueue(ENTRY)).resolves.toEqual({ status: 'retry' });
    await expect(submitPubCommunity(ENTRY)).resolves.toBeNull();

    expect(ensureAccount).toHaveBeenCalledTimes(2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('public submitPubCommunity still returns null for every failure', async () => {
    setBackend('https://api.example.com');
    for (const status of [400, 401, 428, 500]) {
      global.fetch = fetchReturning(status) as unknown as typeof fetch;
      await expect(submitPubCommunity(ENTRY)).resolves.toBeNull();
    }
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(submitPubCommunity(ENTRY)).resolves.toBeNull();
  });
});
