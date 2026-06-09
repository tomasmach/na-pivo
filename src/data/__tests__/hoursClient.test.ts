import { fetchPubHours } from '../hoursClient';
import type { Pub } from '../pubs';

const PUB_A: Pub = { id: 'mapy:50.0,14.0', name: 'U Fleků', lat: 50.0, lng: 14.0, city: 'Praha' };
const PUB_B: Pub = { id: 'mapy:50.1,14.1', name: 'U Tygra', lat: 50.1, lng: 14.1 };

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

describe('fetchPubHours — dormant feature', () => {
  it('resolves to an empty Map when the backend URL is unset', async () => {
    setBackend(undefined);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A]);

    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves to an empty Map when the backend URL is empty/whitespace', async () => {
    setBackend('   ');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A]);

    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('resolves to an empty Map for an empty pub list without calling fetch', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([]);

    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchPubHours — happy path', () => {
  it('maps results back to pub.id BY INDEX (not by backend key)', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          // Note: keys are geohashes, deliberately NOT our ids.
          {
            key: 'u2fkbn',
            name: 'whatever',
            opening_hours: 'Po–Ne 11:00–23:00',
            isOpenNow: true,
            nextChange: '2026-06-08T23:00:00+02:00',
            status: 'ok',
          },
          {
            key: 'u2fkbq',
            name: 'whatever2',
            opening_hours: null,
            isOpenNow: false,
            nextChange: null,
            status: 'ok',
          },
        ],
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A, PUB_B]);

    expect(result.size).toBe(2);
    expect(result.get(PUB_A.id)).toEqual({
      openingHours: 'Po–Ne 11:00–23:00',
      isOpenNow: true,
      nextChange: '2026-06-08T23:00:00+02:00',
      status: 'ok',
    });
    expect(result.get(PUB_B.id)).toEqual({
      openingHours: null,
      isOpenNow: false,
      nextChange: null,
      status: 'ok',
    });
  });

  it('POSTs the correct body and sync_budget for a single pub', async () => {
    setBackend('https://api.example.com/');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ status: 'unknown' }] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fetchPubHours([PUB_A]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    // Trailing slash on the base URL must not produce a double slash.
    expect(url).toBe('https://api.example.com/v1/pub-hours');
    expect(init.method).toBe('POST');
    const parsed = JSON.parse(init.body as string);
    expect(parsed.sync_budget).toBe(1);
    expect(parsed.pubs).toEqual([
      { name: 'U Fleků', lat: 50.0, lng: 14.0, city: 'Praha' },
    ]);
  });

  it('caps sync_budget at 5 for many pubs', async () => {
    setBackend('https://api.example.com');
    const many: Pub[] = Array.from({ length: 8 }, (_, i) => ({
      id: `mapy:${i}`,
      name: `Pub ${i}`,
      lat: i,
      lng: i,
    }));
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: many.map(() => ({ status: 'ok' })) }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fetchPubHours(many);

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).sync_budget).toBe(5);
  });

  it('normalizes unknown/missing statuses to "unknown" and missing booleans to null', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ status: 'weird-value' }] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A]);

    expect(result.get(PUB_A.id)).toEqual({
      openingHours: null,
      isOpenNow: null,
      nextChange: null,
      status: 'unknown',
    });
  });

  it('returns a partial Map when the backend returns fewer results than pubs', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ status: 'ok', opening_hours: 'X' }] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A, PUB_B]);

    expect(result.size).toBe(1);
    expect(result.has(PUB_A.id)).toBe(true);
    expect(result.has(PUB_B.id)).toBe(false);
  });
});

describe('fetchPubHours — never throws', () => {
  it('returns an empty Map on a network error', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(fetchPubHours([PUB_A])).resolves.toEqual(new Map());
  });

  it('returns an empty Map on a non-2xx HTTP response', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchPubHours([PUB_A])).resolves.toEqual(new Map());
  });

  it('returns an empty Map on malformed JSON', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    })) as unknown as typeof fetch;

    await expect(fetchPubHours([PUB_A])).resolves.toEqual(new Map());
  });

  it('returns an empty Map when results is missing/not an array', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: 'nope' }),
    })) as unknown as typeof fetch;

    await expect(fetchPubHours([PUB_A])).resolves.toEqual(new Map());
  });
});

describe('fetchPubHours — abort handling', () => {
  it('returns an empty Map immediately when the signal is already aborted', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();

    const result = await fetchPubHours([PUB_A], controller.signal);

    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes an AbortSignal to fetch and resolves empty when aborted mid-flight', async () => {
    setBackend('https://api.example.com');
    const controller = new AbortController();

    global.fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const sig = init.signal as AbortSignal;
          expect(sig).toBeInstanceOf(AbortSignal);
          sig.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const promise = fetchPubHours([PUB_A], controller.signal);
    controller.abort();

    await expect(promise).resolves.toEqual(new Map());
  });
});
