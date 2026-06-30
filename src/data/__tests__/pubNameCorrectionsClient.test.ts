import {
  buildPubNameCorrectionEntry,
  submitPubNameCorrection,
} from '../pubNameCorrectionsClient';
import { clearCachedAnonymousAccount, ensureAccount } from '../account';
import type { Pub } from '../pubs';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => true),
  generateUuidV4: jest.fn(() => 'client-id'),
}));

jest.mock('../telemetryClient', () => ({
  trackApiFailure: jest.fn(),
}));

const PUB: Pub = {
  id: 'mapy:50.08120,14.41820',
  name: 'Hospoda U Testu',
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

describe('buildPubNameCorrectionEntry', () => {
  it('builds the backend wire payload from a pub and suggested name', () => {
    expect(buildPubNameCorrectionEntry(PUB, ' U Testu po novém ')).toEqual({
      client_id: 'client-id',
      name: 'Hospoda U Testu',
      suggested_name: 'U Testu po novém',
      lat: 50.0812,
      lng: 14.4182,
      city: 'Praha',
      address: 'Testovací 12',
      external_id: 'mapy:50.08120,14.41820',
    });
  });
});

describe('submitPubNameCorrection', () => {
  const entry = buildPubNameCorrectionEntry(PUB, 'U Testu po novém', 'client-1');

  it('returns retry without a backend URL and does not ensure an account', async () => {
    setBackend(undefined);
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('retry');

    expect(ensureAccount).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('POSTs the correction with bearer auth and returns ok for OK responses', async () => {
    setBackend('https://api.example.com/');
    (ensureAccount as jest.Mock).mockResolvedValue({
      deviceId: 'dev-1',
      accountId: 'acc-1',
      token: 'secret-token',
    });
    const fetchSpy = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({}) }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('ok');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/pub-name-corrections');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-token',
    });
    expect(JSON.parse(init.body as string)).toEqual(entry);
  });

  it('clears cached anonymous account on 401 and returns retry', async () => {
    setBackend('https://api.example.com');
    const session = { deviceId: 'd', accountId: 'a', token: 't' };
    (ensureAccount as jest.Mock).mockResolvedValue(session);
    global.fetch = jest.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('retry');

    expect(clearCachedAnonymousAccount).toHaveBeenCalledWith(session);
  });

  it('returns permanent-error for validation failures', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValue({
      deviceId: 'd',
      accountId: 'a',
      token: 't',
    });
    global.fetch = jest.fn(async () => ({ ok: false, status: 400 })) as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('permanent-error');

    global.fetch = jest.fn(async () => ({ ok: false, status: 422 })) as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('permanent-error');
  });

  it('returns retry for throttling, server errors, and network failures', async () => {
    setBackend('https://api.example.com');
    (ensureAccount as jest.Mock).mockResolvedValue({
      deviceId: 'd',
      accountId: 'a',
      token: 't',
    });
    global.fetch = jest.fn(async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('retry');

    global.fetch = jest.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('retry');

    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await expect(submitPubNameCorrection(entry)).resolves.toBe('retry');
  });
});
