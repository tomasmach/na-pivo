import { buildDrinkEntry, submitDrink, deleteDrink, updateDrinkName, type DrinkInput } from '../drinksClient';
import { clearCachedAnonymousAccount, ensureAccount } from '../account';

// drinksClient → account → expo-secure-store, which isn't transformed for the
// node test env; mock it so the module loads. We also stub ensureAccount so the
// network path doesn't depend on the registration flow. jest hoists these mocks
// above the imports above.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../account', () => ({
  ...jest.requireActual('../account'),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
  ensureAccount: jest.fn(async () => ({ deviceId: 'd', accountId: 'a', token: 'tok' })),
}));

jest.mock('../telemetryClient', () => ({
  trackApiFailure: jest.fn(),
  trackClientEvent: jest.fn(async () => undefined),
}));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function setBackend(url: string | undefined): void {
  if (url === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = url;
}

const INPUT: DrinkInput = {
  externalId: 'mapy:50.08755,14.42141',
  name: 'U Zlatého tygra',
  lat: 50.0876,
  lng: 14.4214,
  city: '  Praha  ',
  beer: { name: 'Pilsner Urquell', priceCzk: 62, volumeMl: 500 },
  drankAt: '2026-06-12T19:45:00+02:00',
};

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  setBackend(ORIGINAL_URL);
  jest.clearAllMocks();
});

describe('buildDrinkEntry', () => {
  it('maps camelCase → snake_case with required beer fields', () => {
    const entry = buildDrinkEntry(INPUT, 'client-1');
    expect(entry).toEqual({
      client_id: 'client-1',
      name: 'U Zlatého tygra',
      lat: 50.0876,
      lng: 14.4214,
      city: 'Praha',
      external_id: 'mapy:50.08755,14.42141',
      beer: { name: 'Pilsner Urquell', price_czk: 62, volume_ml: 500 },
      drank_at: '2026-06-12T19:45:00+02:00',
    });
  });

  it('omits volume_ml when absent and trims/drops an empty city', () => {
    const entry = buildDrinkEntry(
      { externalId: null, name: 'X', lat: 1, lng: 2, city: '   ', beer: { name: 'Kozel', priceCzk: 40 } },
      'c',
    );
    expect(entry.beer).toEqual({ name: 'Kozel', price_czk: 40 });
    expect(entry.city).toBeUndefined();
    expect(entry.external_id).toBeNull();
  });

  it('defaults drank_at to now when not provided', () => {
    const { drank_at } = buildDrinkEntry(
      { name: 'X', lat: 1, lng: 2, beer: { name: 'Kozel', priceCzk: 40 } },
      'c',
    );
    expect(typeof drank_at).toBe('string');
    expect(Number.isNaN(Date.parse(drank_at as string))).toBe(false);
  });

  it('adds the category for non-beer drinks without changing the legacy item shape', () => {
    const entry = buildDrinkEntry(
      {
        name: 'X',
        lat: 1,
        lng: 2,
        drinkType: 'shot',
        beer: { name: 'Slivovice', priceCzk: 65, volumeMl: 40 },
      },
      'shot-1',
    );
    expect(entry.drink_type).toBe('shot');
    expect(entry.beer).toEqual({ name: 'Slivovice', price_czk: 65, volume_ml: 40 });
  });
});

describe('submitDrink', () => {
  const entry = buildDrinkEntry(INPUT, 'client-1');

  it('is a dormant no-op (retry) when no backend is configured', async () => {
    setBackend(undefined);
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('retry');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs to /v1/drinks with the Bearer token and returns ok on 2xx', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({}) }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(submitDrink(entry)).resolves.toBe('ok');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/drinks');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual(entry);
  });

  it('returns permanent-error on validation 4xx responses', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('permanent-error');

    global.fetch = jest.fn(async () => ({ ok: false, status: 422, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('permanent-error');
  });

  it('keeps deploy-mismatch 404 responses queued for retry', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('retry');
  });

  it('lets anonymous sessions recover on 401 and retry later', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValueOnce({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: false,
    });
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('retry');
    expect(clearCachedAnonymousAccount).toHaveBeenCalledWith({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: false,
    });
  });

  it('does not clear an authenticated session on 401', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValueOnce({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: true,
    });
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;

    await expect(submitDrink(entry)).resolves.toBe('retry');

    expect(clearCachedAnonymousAccount).toHaveBeenCalledWith({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: true,
    });
  });

  it('returns retry on 429 (throttled)', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('retry');
  });

  it('returns retry on 5xx', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('retry');
  });

  it('returns retry on a network error (never throws)', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('retry');
  });

  it('returns retry when there is no account session', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValueOnce(null);
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(submitDrink(entry)).resolves.toBe('retry');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('deleteDrink', () => {
  it('is a dormant no-op (retry) when no backend is configured', async () => {
    setBackend(undefined);
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(deleteDrink('client-1')).resolves.toBe('retry');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('DELETEs /v1/drinks/<client_id> with the Bearer token and returns ok on 2xx', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ deleted: true }) }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(deleteDrink('client-1')).resolves.toBe('ok');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/drinks/client-1');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('returns permanent-error on validation 4xx and retry on recoverable failures', async () => {
    setBackend('https://api.example.com');

    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(deleteDrink('c')).resolves.toBe('permanent-error');

    global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(deleteDrink('c')).resolves.toBe('retry');

    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(deleteDrink('c')).resolves.toBe('retry');

    global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(deleteDrink('c')).resolves.toBe('retry');

    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(deleteDrink('c')).resolves.toBe('retry');
  });

  it('keeps delete queued on 401 and delegates only anonymous recovery', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValueOnce({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: true,
    });
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(deleteDrink('c')).resolves.toBe('retry');
    expect(clearCachedAnonymousAccount).toHaveBeenCalledWith({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: true,
    });
  });

  it('returns retry when there is no account session', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValueOnce(null);
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(deleteDrink('c')).resolves.toBe('retry');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('updateDrinkName', () => {
  it('is a dormant no-op (retry) when no backend is configured', async () => {
    setBackend(undefined);
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(updateDrinkName('client-1', 'Kozel')).resolves.toBe('retry');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('PATCHes /v1/drinks/<client_id> with the Bearer token and returns ok on 2xx', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ updated: true }) }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(updateDrinkName('client-1', 'Kozel')).resolves.toBe('ok');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/drinks/client-1');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ beer_name: 'Kozel' });
  });

  it('returns permanent-error on validation 4xx and retry on recoverable failures', async () => {
    setBackend('https://api.example.com');

    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(updateDrinkName('c', '')).resolves.toBe('permanent-error');

    global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(updateDrinkName('c', 'Kozel')).resolves.toBe('retry');

    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(updateDrinkName('c', 'Kozel')).resolves.toBe('retry');

    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(updateDrinkName('c', 'Kozel')).resolves.toBe('retry');
  });
});
