import type { Pub } from '../pubs';
import {
  localPubSearch,
  resolvePubSearchResult,
  searchPubNames,
  type PubSearchResult,
} from '../pubSearchClient';

const loadedPubs: Pub[] = [];

jest.mock('../pubs', () => ({
  getAllLoadedPubs: () => loadedPubs,
  hydratePubsSnapshot: jest.fn(async () => true),
}));

describe('pubSearchClient', () => {
  const originalFetch = global.fetch;
  const originalBackend = process.env.EXPO_PUBLIC_BACKEND_URL;

  beforeEach(() => {
    loadedPubs.splice(0);
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalBackend === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
    else process.env.EXPO_PUBLIC_BACKEND_URL = originalBackend;
    jest.clearAllMocks();
  });

  it('searches the loaded catalogue by name, city and address without diacritics', () => {
    loadedPubs.push(
      { id: 'local-1', name: 'Hospůdka U Jelena', city: 'Brno', address: 'Česká 1', lat: 49.2, lng: 16.6 },
      { id: 'local-2', name: 'U Jelena', city: 'Olomouc', lat: 49.59, lng: 17.25 },
    );

    expect(localPubSearch('hospudka ceska')).toEqual([
      expect.objectContaining({ id: 'local-1', name: 'Hospůdka U Jelena', pub: loadedPubs[0] }),
    ]);
    expect(localPubSearch('jelen, Brno')).toHaveLength(1);
  });

  it('does not return catalogue rows classified as not pubs', () => {
    loadedPubs.push({
      id: 'not-pub',
      name: 'Jelen Sushi',
      lat: 49.2,
      lng: 16.6,
      venueKind: 'not_pub',
    });
    expect(localPubSearch('jelen')).toEqual([]);
  });

  it('keeps rich local pubs first and merges old coordinate and Google suggestion shapes', async () => {
    const local: Pub = {
      id: 'directory-1',
      name: 'U Jelena',
      city: 'Brno',
      lat: 49.2,
      lng: 16.6,
      rating: 4.7,
    };
    loadedPubs.push(local);
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { id: 'old-duplicate', name: 'Duplicate', position: { lat: 49.2, lon: 16.6 } },
          { id: 'old-2', name: 'U Dvou dubů', position: { lat: 49.3, lon: 16.7 }, city: 'Brno' },
          { id: 'google:abc', name: 'Pivnice Jelen', providerPlaceId: 'abc', location: 'Znojmo' },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await searchPubNames('jelen');

    expect(result.failed).toBe(false);
    expect(result.pubs.map((pub) => pub.id)).toEqual(['directory-1', 'old-2', 'google:abc']);
    expect(result.pubs[0].pub).toBe(local);
    expect(result.pubs[2]).toEqual(expect.objectContaining({ providerPlaceId: 'abc', location: 'Znojmo' }));
  });

  it('returns local matches and failed true for HTTP, network and abort failures', async () => {
    loadedPubs.push({ id: 'local-1', name: 'U Jelena', lat: 49.2, lng: 16.6 });

    global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    await expect(searchPubNames('jelena')).resolves.toEqual({
      pubs: [expect.objectContaining({ id: 'local-1' })],
      failed: true,
    });

    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(searchPubNames('jelena')).resolves.toEqual({
      pubs: [expect.objectContaining({ id: 'local-1' })],
      failed: true,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(searchPubNames('jelena', controller.signal)).resolves.toEqual({
      pubs: [expect.objectContaining({ id: 'local-1' })],
      failed: true,
    });
  });

  it('marks malformed payloads failed and safely discards malformed or unresolved rows', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ nope: [] }) })) as unknown as typeof fetch;
    await expect(searchPubNames('jelen')).resolves.toEqual({ pubs: [], failed: true });

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          null,
          4,
          { id: 'broken-regions', name: 'Jelen', providerPlaceId: 'place', regionalStructure: 4 },
          { id: 'unresolved', name: 'Bez bodu' },
        ],
      }),
    })) as unknown as typeof fetch;
    await expect(searchPubNames('jelen')).resolves.toEqual({
      pubs: [expect.objectContaining({ id: 'broken-regions', providerPlaceId: 'place' })],
      failed: false,
    });
  });

  it('bounds requests with an internal timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as unknown as typeof fetch;

    const request = searchPubNames('jelen');
    await jest.advanceTimersByTimeAsync(8_000);
    await expect(request).resolves.toEqual({ pubs: [], failed: true });
    jest.useRealTimers();
  });

  it('resolves a Google suggestion without coordinates through place_id', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [{
          id: 'google:abc',
          name: 'U Zlatého jelena',
          providerPlaceId: 'abc',
          position: { lat: 49.2, lon: 16.6 },
          regionalStructure: [
            { name: 'Brno', type: 'regional.municipality' },
            { name: 'Lipová 12', type: 'regional.street' },
          ],
        }],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const suggestion: PubSearchResult = {
      id: 'google:abc',
      name: 'U Zlatého jelena',
      providerPlaceId: 'abc',
      location: 'Brno',
    };

    await expect(resolvePubSearchResult(suggestion)).resolves.toEqual(
      expect.objectContaining({
        id: 'google:abc',
        lat: 49.2,
        lng: 16.6,
        city: 'Brno',
        address: 'Lipová 12',
        googlePlaceId: 'abc',
      }),
    );
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ query: 'U Zlatého jelena', place_id: 'abc' });
  });

  it('never throws and rejects malformed coordinates while resolving', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ id: 'bad', name: 'Bad', position: { lat: 999, lon: 16.6 } }] }),
    })) as unknown as typeof fetch;
    const suggestion = { id: 'google:bad', name: 'Bad', providerPlaceId: 'bad' };
    await expect(resolvePubSearchResult(suggestion)).resolves.toBeNull();

    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(resolvePubSearchResult(suggestion)).resolves.toBeNull();

    const controller = new AbortController();
    controller.abort();
    await expect(resolvePubSearchResult(suggestion, controller.signal)).resolves.toBeNull();
  });

  it('uses the selected result as fallback when geocode only returns coordinates', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ position: { lat: 49.2, lon: 16.6 } }] }),
    })) as unknown as typeof fetch;
    await expect(resolvePubSearchResult({
      id: 'google:abc',
      name: 'U Jelena',
      providerPlaceId: 'abc',
      location: 'Brno',
    })).resolves.toEqual(expect.objectContaining({
      id: 'google:abc',
      name: 'U Jelena',
      lat: 49.2,
      lng: 16.6,
      googlePlaceId: 'abc',
    }));
  });
});
