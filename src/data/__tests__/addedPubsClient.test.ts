import { buildAddedPubEntry, submitAddedPub } from '../addedPubsClient';
import { clearCachedAnonymousAccount, ensureAccount } from '../account';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => true),
}));

jest.mock('../telemetryClient', () => ({
  trackApiFailure: jest.fn(),
}));

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

describe('buildAddedPubEntry', () => {
  it('trims optional user input for the wire payload', () => {
    expect(
      buildAddedPubEntry(
        {
          name: ' U Testu ',
          lat: 50.0812,
          lng: 14.4182,
          city: ' Praha ',
          address: ' Testovací 12 ',
        },
        'client-1',
      ),
    ).toEqual({
      client_id: 'client-1',
      name: 'U Testu',
      lat: 50.0812,
      lng: 14.4182,
      city: 'Praha',
      address: 'Testovací 12',
    });
  });
});

describe('submitAddedPub', () => {
  const entry = buildAddedPubEntry(
    {
      name: 'U Testu',
      lat: 50.0812,
      lng: 14.4182,
      city: 'Praha',
      address: 'Testovací 12',
    },
    'client-1',
  );

  beforeEach(() => {
    (ensureAccount as jest.Mock).mockResolvedValue({
      deviceId: 'd',
      accountId: 'a',
      token: 't',
    });
  });

  it('returns retry without a backend URL and does not ensure an account', async () => {
    setBackend(undefined);
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('retry');

    expect(ensureAccount).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs the pub with bearer auth and returns the parsed response on OK', async () => {
    setBackend('https://api.example.com/');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        client_id: 'client-1',
        cache_key: 'u2fkbnhz',
        name: 'U Testu',
        lat: 50.0813,
        lng: 14.4183,
        city: 'Praha',
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toEqual({
      clientId: 'client-1',
      cacheKey: 'u2fkbnhz',
      name: 'U Testu',
      lat: 50.0813,
      lng: 14.4183,
      city: 'Praha',
      address: undefined,
    });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/pubs');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer t',
    });
    expect(JSON.parse(init.body as string)).toEqual(entry);
  });

  it('returns permanent-error for validation failures', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({ ok: false, status: 400 })) as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('permanent-error');

    global.fetch = jest.fn(async () => ({ ok: false, status: 422 })) as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('permanent-error');
  });

  it('clears cached anonymous account on 401 and returns retry', async () => {
    setBackend('https://api.example.com');
    const session = { deviceId: 'd', accountId: 'a', token: 't' };
    (ensureAccount as jest.Mock).mockResolvedValue(session);
    global.fetch = jest.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('retry');

    expect(clearCachedAnonymousAccount).toHaveBeenCalledWith(session, {
      source: 'added_pub_submit',
      endpoint: '/v1/pubs',
    });
  });

  it('returns retry for throttling, server errors, malformed OK responses, and network failures', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('retry');

    global.fetch = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('retry');

    global.fetch = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({}) })) as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('retry');

    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(submitAddedPub(entry)).resolves.toBe('retry');
  });
});
