import {
  addBeerWatch,
  fetchBeerWatches,
  removeBeerWatch,
  updateBeerWatchSettings,
} from '../beerWatchClient';

const mockClearCachedAnonymousAccount = jest.fn();
jest.mock('../account', () => ({
  ensureAccount: async () => ({ token: 'synthetic-token', accountId: 'account-1' }),
  clearCachedAnonymousAccount: (...args: unknown[]) => mockClearCachedAnonymousAccount(...args),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}`,
}));

const originalFetch = global.fetch;
function respond(status: number, body?: unknown) {
  jest.mocked(global.fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}
function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = jest.mocked(global.fetch).mock.calls.at(-1)!;
  return { url: String(url), init: init! };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn() as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('GETs watches with radius, location flag and helped counts', async () => {
  respond(200, {
    radius_m: 3000,
    location_set: true,
    watches: [{ product_key: 'unetice-12', name: 'Únětická 12°', aliases: ['Únětické 12'] }, { bad: 1 }],
    helped: [{ cache_key: 'u2fkbbbb', product_name: 'Únětická 12°', helped_count: 3 }],
  });

  await expect(fetchBeerWatches()).resolves.toEqual({
    radiusM: 3000,
    locationSet: true,
    watches: [{ productKey: 'unetice-12', name: 'Únětická 12°', aliases: ['Únětické 12'] }],
    helped: [{ cacheKey: 'u2fkbbbb', productName: 'Únětická 12°', helpedCount: 3 }],
  });
  expect(lastCall().url).toBe('http://127.0.0.1:8012/v1/beer-watches');
  expect(lastCall().init.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
});

it('returns null instead of throwing when offline', async () => {
  jest.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Network request failed'));
  await expect(fetchBeerWatches()).resolves.toBeNull();
});

it('drops the anonymous token on 401', async () => {
  respond(401);
  await expect(fetchBeerWatches()).resolves.toBeNull();
  expect(mockClearCachedAnonymousAccount).toHaveBeenCalled();
});

it('POSTs the lístek name and optional brewery', async () => {
  respond(201, { product_key: 'unetice-12', name: 'Únětická 12°', aliases: [] });

  await expect(addBeerWatch('Únětická 12', 'Únětický pivovar')).resolves.toEqual({
    ok: true,
    watch: { productKey: 'unetice-12', name: 'Únětická 12°', aliases: [] },
  });
  expect(lastCall().init.method).toBe('POST');
  expect(JSON.parse(lastCall().init.body as string)).toEqual({
    beer_name: 'Únětická 12',
    brewery_name: 'Únětický pivovar',
  });
});

it('treats an already watched beer (200) as success and omits an empty brewery', async () => {
  respond(200, { product_key: 'unetice-12', name: 'Únětická 12°', aliases: [] });
  await expect(addBeerWatch('Únětická 12', '')).resolves.toMatchObject({ ok: true });
  expect(JSON.parse(lastCall().init.body as string)).toEqual({ beer_name: 'Únětická 12' });
});

it.each(['unknown_beer', 'too_many'] as const)('maps 422 %s', async (code) => {
  respond(422, { code });
  await expect(addBeerWatch('Domácí ležák')).resolves.toEqual({ ok: false, reason: code });
});

it('maps other failures to a generic one', async () => {
  respond(503);
  await expect(addBeerWatch('Únětická 12')).resolves.toEqual({ ok: false, reason: 'failed' });
});

it('DELETEs by product key and accepts 204', async () => {
  respond(204);
  await expect(removeBeerWatch('unetice 12/°')).resolves.toBe(true);
  expect(lastCall().url).toBe('http://127.0.0.1:8012/v1/beer-watches/unetice%2012%2F%C2%B0');
  expect(lastCall().init.method).toBe('DELETE');
});

it('PATCHes the radius alone, or lat and lng together', async () => {
  respond(200, { radius_m: 5000, location_set: false });
  await expect(updateBeerWatchSettings({ radiusM: 5000 })).resolves.toEqual({
    radiusM: 5000,
    locationSet: false,
    watches: null,
    helped: null,
  });
  expect(lastCall().url).toBe('http://127.0.0.1:8012/v1/beer-watches/settings');
  expect(JSON.parse(lastCall().init.body as string)).toEqual({ radius_m: 5000 });

  respond(200, { radius_m: 5000, location_set: true });
  await updateBeerWatchSettings({ lat: 50.08275, lng: 14.4165 });
  expect(lastCall().init.method).toBe('PATCH');
  expect(JSON.parse(lastCall().init.body as string)).toEqual({ lat: 50.08275, lng: 14.4165 });
});
