import { ensureAccount } from '../account';
import { fetchBlockedPubReports, reportPubIssue } from '../pubReportsClient';
import type { Pub } from '../pubs';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
}));

const PUB: Pub = {
  id: 'mapy:50.08120,14.41820',
  name: 'Palačinkárna U Testu',
  lat: 50.0812,
  lng: 14.4182,
  city: 'Praha',
  address: 'Testovací 12',
};

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function setBackend(url: string | undefined): void {
  if (url === undefined) {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
  } else {
    process.env.EXPO_PUBLIC_BACKEND_URL = url;
  }
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  setBackend(ORIGINAL_URL);
  jest.clearAllMocks();
});

describe('reportPubIssue', () => {
  it('returns false without a backend URL and does not ensure an account', async () => {
    setBackend(undefined);
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(reportPubIssue(PUB, 'not_pub')).resolves.toBe(false);

    expect(ensureAccount).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns false when no account session is available', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValue(null);
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(reportPubIssue(PUB, 'closed')).resolves.toBe(false);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs the report with bearer auth and returns true for OK responses', async () => {
    setBackend('https://api.example.com/');
    (ensureAccount as jest.Mock).mockResolvedValue({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'secret-token',
    });
    const fetchSpy = jest.fn(async () => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(reportPubIssue(PUB, 'not_pub')).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/pub-reports');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-token',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      name: PUB.name,
      lat: PUB.lat,
      lng: PUB.lng,
      city: PUB.city,
      address: PUB.address,
      external_id: PUB.id,
      reason: 'not_pub',
    });
  });

  it('never throws on network errors or non-OK responses', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValue({ deviceId: 'd', accountId: 'a', token: 't' });

    global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    await expect(reportPubIssue(PUB, 'closed')).resolves.toBe(false);

    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(reportPubIssue(PUB, 'closed')).resolves.toBe(false);
  });
});

describe('fetchBlockedPubReports', () => {
  it('returns an empty array when dormant', async () => {
    setBackend('   ');
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(fetchBlockedPubReports(50.08, 14.42, 5)).resolves.toEqual([]);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('GETs blocked reports and normalizes the response', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        blocked: [
          { cache_key: 'u2fk1234', external_id: PUB.id, reason: 'not_pub' },
          { cache_key: 'u2fk9999', external_id: null, reason: 'closed' },
          { cache_key: 'bad', external_id: 'bad', reason: 'weird' },
        ],
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchBlockedPubReports(50.08, 14.42, 5);

    expect(result).toEqual([
      { cacheKey: 'u2fk1234', externalId: PUB.id, reason: 'not_pub' },
      { cacheKey: 'u2fk9999', externalId: null, reason: 'closed' },
    ]);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/pub-reports/blocked?lat=50.08&lng=14.42&radius_km=5');
    expect(init.method).toBe('GET');
  });

  it('never throws on failures', async () => {
    setBackend('https://api.example.com');

    global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    await expect(fetchBlockedPubReports(50.08, 14.42, 5)).resolves.toEqual([]);

    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(fetchBlockedPubReports(50.08, 14.42, 5)).resolves.toEqual([]);
  });
});
