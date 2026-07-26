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
      source: null,
      communityHours: null,
      beers: [],
      historicalBeers: [],
      beersUpdatedAt: null,
      beerMenuRotates: false,
      hoursUpdatedAt: null,
      rating: null,
      ratingCount: null,
      ratingLabel: null,
      hasGarden: null,
      venueKind: 'unknown',
    });
    expect(result.get(PUB_B.id)).toEqual({
      openingHours: null,
      isOpenNow: false,
      nextChange: null,
      status: 'ok',
      source: null,
      communityHours: null,
      beers: [],
      historicalBeers: [],
      beersUpdatedAt: null,
      beerMenuRotates: false,
      hoursUpdatedAt: null,
      rating: null,
      ratingCount: null,
      ratingLabel: null,
      hasGarden: null,
      venueKind: 'unknown',
    });
  });

  it('POSTs the correct body and a cache-only sync_budget for a single pub', async () => {
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
    expect(parsed.sync_budget).toBe(0);
    expect(parsed.pubs).toEqual([
      { name: 'U Fleků', lat: 50.0, lng: 14.0, city: 'Praha' },
    ]);
  });

  it('allows callers to override sync_budget explicitly', async () => {
    setBackend('https://api.example.com/');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ status: 'unknown' }] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await fetchPubHours([PUB_A], undefined, { syncBudget: 1 });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).sync_budget).toBe(1);
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
      source: null,
      communityHours: null,
      beers: [],
      historicalBeers: [],
      beersUpdatedAt: null,
      beerMenuRotates: false,
      hoursUpdatedAt: null,
      rating: null,
      ratingCount: null,
      ratingLabel: null,
      hasGarden: null,
      venueKind: 'unknown',
    });
  });

  it('parses the optional community source / hours_json / beers fields', async () => {
    setBackend('https://api.example.com');
    const hoursJson = {
      mo: [['11:00', '23:00']],
      tu: [],
      we: [['11:00', '23:00']],
      th: [['11:00', '23:00']],
      fr: [['11:00', '00:00']],
      sa: [['12:00', '00:00']],
      su: [],
    };
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            status: 'ok',
            isOpenNow: true,
            source: 'community',
            hours_json: hoursJson,
            beers: [
              { name: 'Pilsner Urquell 12°', price_czk: 65, volume_ml: 500 },
              { name: 'Kozel 11°' },
            ],
            historical_beers: [{ name: 'Gambrinus 10°', price_czk: 49, volume_ml: 500 }],
            beers_updated_at: '2026-07-13T10:15:00Z',
            hours_updated_at: '2026-07-12T09:00:00Z',
          },
        ],
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A]);
    const entry = result.get(PUB_A.id);

    expect(entry?.source).toBe('community');
    expect(entry?.communityHours).toEqual(hoursJson);
    expect(entry?.beers).toEqual([
      { name: 'Pilsner Urquell 12°', priceCzk: 65, volumeMl: 500 },
      { name: 'Kozel 11°' },
    ]);
    expect(entry?.historicalBeers).toEqual([
      { name: 'Gambrinus 10°', priceCzk: 49, volumeMl: 500 },
    ]);
    expect(entry?.beersUpdatedAt).toBe('2026-07-13T10:15:00Z');
    expect(entry?.hoursUpdatedAt).toBe('2026-07-12T09:00:00Z');
  });

  it('tolerates absent community fields (old backend) without breaking', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ status: 'ok', isOpenNow: true }] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const entry = (await fetchPubHours([PUB_A])).get(PUB_A.id);
    expect(entry?.source).toBeNull();
    expect(entry?.communityHours).toBeNull();
    expect(entry?.beers).toEqual([]);
    expect(entry?.historicalBeers).toEqual([]);
    expect(entry?.beersUpdatedAt).toBeNull();
    expect(entry?.rating).toBeNull();
    expect(entry?.ratingCount).toBeNull();
    expect(entry?.ratingLabel).toBeNull();
    expect(entry?.hasGarden).toBeNull();
    // Missing venueKind on an older backend must default to 'unknown'.
    expect(entry?.venueKind).toBe('unknown');
  });

  it('parses optional source rating fields', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            status: 'ok',
            rating: 4.1,
            ratingCount: 364,
            ratingLabel: 'Velmi dobré',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const entry = (await fetchPubHours([PUB_A])).get(PUB_A.id);
    expect(entry?.rating).toBe(4.1);
    expect(entry?.ratingCount).toBe(364);
    expect(entry?.ratingLabel).toBe('Velmi dobré');
  });

  it('parses the optional garden flag', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { status: 'ok', hasGarden: true },
          { status: 'ok', hasGarden: false },
        ],
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A, PUB_B]);

    expect(result.get(PUB_A.id)?.hasGarden).toBe(true);
    expect(result.get(PUB_B.id)?.hasGarden).toBe(false);
  });

  it.each(['pub', 'maybe', 'not_pub', 'unknown'] as const)(
    'parses the venueKind verdict "%s" from the backend',
    async (kind) => {
      setBackend('https://api.example.com');
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ results: [{ status: 'ok', venueKind: kind }] }),
      })) as unknown as typeof fetch;

      const entry = (await fetchPubHours([PUB_A])).get(PUB_A.id);
      expect(entry?.venueKind).toBe(kind);
    },
  );

  it('normalizes an unrecognized / null venueKind to "unknown"', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { status: 'ok', venueKind: 'restaurant' },
          { status: 'ok', venueKind: null },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await fetchPubHours([PUB_A, PUB_B]);
    expect(result.get(PUB_A.id)?.venueKind).toBe('unknown');
    expect(result.get(PUB_B.id)?.venueKind).toBe('unknown');
  });

  it('ignores a malformed hours_json that is not a valid weekly object', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [{ status: 'ok', source: 'community', hours_json: { mo: 'nope' } }],
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const entry = (await fetchPubHours([PUB_A])).get(PUB_A.id);
    expect(entry?.communityHours).toBeNull();
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
