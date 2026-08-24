/**
 * Name + label classification for Mapy.cz POIs (isAcceptablePubName).
 *
 * The heuristic decides whether a suggested place survives filtering before it
 * ever reaches the compass. The table below is built from REAL names seen in
 * live Mapy.cz /v1/suggest responses, split into the ones that must be KEPT
 * (a real pub / half-restaurant / a positive beer keyword) and the ones that
 * must be DROPPED (cafés, sushi, shisha lounges, fast-food chains).
 *
 * Decision logic under test (see mapyClient.ts):
 *   1. Hard chain blocklist → always out (every label).
 *   2. A positive beer keyword in the name → always in (overrides negatives).
 *   3. Trusted labels (Hospoda / Pivnice / Pivovar) → in without negative check.
 *   4. Screened labels (Restaurace a pohostinství / Bar / Klub) → out on a
 *      negative keyword, otherwise in. Pizza is intentionally NOT a negative.
 */

import {
  geocodePubLocation,
  isAcceptablePubName,
  isSpecificGeocodeResult,
  reverseGeocodePubLocation,
  searchPubsNear,
  suggestPubLocations,
} from '../mapyClient';

const REST = 'Restaurace a pohostinství';
const BAR = 'Bar';

function requestJson(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

describe('isAcceptablePubName — must KEEP (live data)', () => {
  it.each([
    // Village "Restaurace …" — often the only pub around; recall must hold.
    ['Restaurace tankovna Modrá kočka', REST],
    ['Restaurace Sokolovna', REST],
    ['Restaurace na růžku', REST],
    ['Restaurace Nový Rybník', REST],
    ['Restaurace Království', REST],
    ['Restaurace U Fleků', REST],
    // Positive beer keywords win even under a screened label.
    ['Hospůdka Nad Viktorkou', REST],
    ['Vinohradský pivovar', REST],
    ['Pivnice U SADU', REST],
    ['Turnovská pivnice Churchill', REST],
    ['Woodoo music pub', BAR],
    ['Bohužel Bar', BAR],
    // Pizza is deliberately not a negative — left to the backend verdict.
    ['Pizzeria Vende Maria', REST],
    // No negative keyword, screened label → kept by default.
    ['U KURELŮ', REST],
  ])('keeps "%s" (label %s)', (name, label) => {
    expect(isAcceptablePubName(name, label)).toBe(true);
  });

  it.each([
    // Curated pub labels are trusted as-is, no negative screening.
    ['Hospoda U Černého vola', 'Hospoda'],
    ['Pivnice Cinská', 'Pivnice'],
    ['Pivovar Sushi House', 'Pivovar'],
  ])('trusts curated label name "%s" (label %s)', (name, label) => {
    expect(isAcceptablePubName(name, label)).toBe(true);
  });
});

describe('isAcceptablePubName — must DROP (live data)', () => {
  it.each([
    ['Sushi Sushi', REST],
    ['Thien Long 1 Asia Bistro', REST],
    ['Bistrotéka', REST],
    ['OPSO SHISHA LOUNGE BAR', BAR],
    ['Fumée Lounge Shisha & Cocktail Bar', BAR],
    ['Kafe v Presu', BAR],
    ['Zahrada - café & bistro', REST],
    // Hard chain blocklist — always out.
    ["mcdonald's", REST],
  ])('drops "%s" (label %s)', (name, label) => {
    expect(isAcceptablePubName(name, label)).toBe(false);
  });
});

describe('isAcceptablePubName — matching mechanics', () => {
  it('matches punctuation-glued keywords (e.g. "Kafe•Akropolis")', () => {
    expect(isAcceptablePubName('Kafe•Akropolis', BAR)).toBe(false);
  });

  it('is diacritics-insensitive ("Kávárna U lípy" reads as a café)', () => {
    expect(isAcceptablePubName('Kávárna U lípy', REST)).toBe(false);
  });

  it('lets "pivo" absorb the whole beer family ("pivovar", "pivnice")', () => {
    expect(isAcceptablePubName('Měšťanský pivovar', REST)).toBe(true);
    expect(isAcceptablePubName('Malá pivnice', BAR)).toBe(true);
  });

  it('does not let a short keyword leak into an unrelated word', () => {
    expect(isAcceptablePubName('Restaurace Pohoda', REST)).toBe(true);
    // "kava" is exact-match only: real pub names starting with the same
    // letters must survive, while a literal "káva" still reads as a café.
    expect(isAcceptablePubName('Restaurace Kavalír', REST)).toBe(true);
    expect(isAcceptablePubName('Kavka Bar', BAR)).toBe(true);
    expect(isAcceptablePubName('Dobrá káva', REST)).toBe(false);
  });

  it('a positive keyword overrides a negative one in the same name', () => {
    // "Pivnice" (positive) beats "bistro" (negative).
    expect(isAcceptablePubName('Pivnice & Bistro', BAR)).toBe(true);
  });

  it('applies negatives only to screened labels, not curated pub labels', () => {
    // Same café-ish name: dropped under Bar, kept under the trusted Hospoda.
    expect(isAcceptablePubName('Kavárna roh', BAR)).toBe(false);
    expect(isAcceptablePubName('Kavárna roh', 'Hospoda')).toBe(true);
  });

  it('hard chain blocklist beats everything, every label', () => {
    expect(isAcceptablePubName('Starbucks Reserve', 'Hospoda')).toBe(false);
    expect(isAcceptablePubName('KFC', BAR)).toBe(false);
  });
});

describe('searchPubsNear — backend proxy only', () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

  // A raw Mapy suggest item — the same shape the backend returns in `items`.
  // Picked so it survives itemToPub.
  const PUB_ITEM = {
    name: 'Hospoda U Testu',
    label: 'Hospoda',
    position: { lat: 50.081, lon: 14.421 },
  };

  function setBackend(url: string | undefined): void {
    if (url === undefined) {
      delete process.env.EXPO_PUBLIC_BACKEND_URL;
    } else {
      process.env.EXPO_PUBLIC_BACKEND_URL = url;
    }
  }

  function calledUrls(fetchMock: jest.Mock): string[] {
    return fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
  }

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    setBackend(ORIGINAL_BACKEND);
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('uses the backend pubs/near endpoint when configured and 200', async () => {
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [PUB_ITEM] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pubs = await searchPubsNear(50.08, 14.42, 25);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toContain('https://api.example.com/v1/pubs/near');
    expect(calledUrl).toContain('lat=50.08');
    expect(calledUrl).toContain('lng=14.42');
    expect(calledUrl).toContain('radius_km=25');
    // The backend's raw items run through the existing itemToPub pipeline.
    expect(pubs).toHaveLength(1);
    expect(pubs[0].name).toBe('Hospoda U Testu');
    expect(pubs[0].venueKind).toBe('pub');
  });

  it('requests and preserves reviewed other tap place metadata only when opted in', async () => {
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          ...PUB_ITEM,
          name: 'Kemp s výčepem',
          label: 'Bar',
          discoveryKind: 'campsite',
        }],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pubs = await searchPubsNear(50.08, 14.42, 25, undefined, {
      includeOtherPlaces: true,
    });

    expect(calledUrls(fetchMock)[0]).toContain('include_other_places=true');
    expect(pubs[0].discoveryKind).toBe('campsite');
  });

  it('maps cache-only nearby details onto the pub', async () => {
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          ...PUB_ITEM,
          pubDetails: {
            opening_hours: 'Mo-Su 11:00-23:00',
            isOpenNow: true,
            nextChange: '2026-07-13T23:00:00+02:00',
            status: 'ok',
            source: 'firmy',
            rating: 4.6,
            ratingCount: 128,
            ratingLabel: 'Výborné',
            venueKind: 'pub',
            beer_menu_rotates: true,
          },
        }],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const [pub] = await searchPubsNear(50.08, 14.42, 25);

    expect(pub).toEqual(expect.objectContaining({
      openingHours: 'Mo-Su 11:00-23:00',
      isOpenNow: true,
      hoursStatus: 'ok',
      rating: 4.6,
      ratingCount: 128,
      ratingLabel: 'Výborné',
      venueKind: 'pub',
      beerMenuRotates: true,
    }));
  });

  it('maps a fresh reference price and rejects an expired one', async () => {
    setBackend('https://api.example.com');
    const now = Date.parse('2026-07-17T12:00:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            ...PUB_ITEM,
            pubDetails: {
              price: {
                czk: 42,
                volume_ml: 500,
                observed_at: '2026-06-30T12:00:00Z',
                source: 'community',
              },
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const [fresh] = await searchPubsNear(50.08, 14.42, 25);
    expect(fresh.price).toEqual({
      czk: 42,
      volumeMl: 500,
      observedAt: '2026-06-30T12:00:00Z',
      source: 'community',
    });

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            ...PUB_ITEM,
            pubDetails: {
              price: {
                czk: 39,
                volume_ml: 500,
                observed_at: '2025-07-01T12:00:00Z',
                source: 'external',
              },
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const [expired] = await searchPubsNear(50.08, 14.42, 25);
    expect(expired.price).toBeNull();
  });

  it('keeps broad restaurant results for the compass but marks them ambiguous', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Restaurace U Testu',
            label: REST,
            position: { lat: 50.081, lon: 14.421 },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const pubs = await searchPubsNear(50.08, 14.42, 25);

    expect(pubs).toHaveLength(1);
    expect(pubs[0].venueKind).toBe('maybe');
  });

  it('treats a beer-positive name under a broad category as a strong pub signal', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Vinohradský pivovar',
            label: REST,
            position: { lat: 50.081, lon: 14.421 },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const pubs = await searchPubsNear(50.08, 14.42, 25);

    expect(pubs).toHaveLength(1);
    expect(pubs[0].venueKind).toBe('pub');
  });

  it('treats a screened bar category as a strong pub signal', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Bar U Testu',
            label: 'Bar',
            position: { lat: 50.081, lon: 14.421 },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const pubs = await searchPubsNear(50.08, 14.42, 25);

    expect(pubs).toHaveLength(1);
    expect(pubs[0].venueKind).toBe('pub');
  });

  it('passes a beer brand filter to the backend pubs/near endpoint', async () => {
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [PUB_ITEM] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchPubsNear(50.08, 14.42, 25, undefined, {
      beerBrandKey: 'pilsner-urquell',
    });

    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(calledUrl.searchParams.get('beer_brand')).toBe('pilsner-urquell');
  });

  it('passes normalized multi-brand filters and accepts the v3 ANY acknowledgement', async () => {
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [PUB_ITEM],
        applied_filters: {
          version: 3,
          match: 'all',
          amenities: ['practical_tank_beer'],
          beer_brand: null,
          beer_brands: ['pilsner-urquell', 'radegast'],
          beer_match: 'any',
        },
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const pubs = await searchPubsNear(50.08, 14.42, 25, undefined, {
      beerBrandKeys: ['radegast', 'pilsner-urquell', 'radegast'],
      amenityKeys: ['practical_tank_beer'],
    });

    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(calledUrl.searchParams.get('beer_brands')).toBe('pilsner-urquell,radegast');
    expect(calledUrl.searchParams.has('beer_brand')).toBe(false);
    expect(calledUrl.searchParams.get('amenities')).toBe('practical_tank_beer');
    expect(pubs).toHaveLength(1);
  });

  it('fails closed when multi-brand filters are not acknowledged exactly', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [PUB_ITEM],
        applied_filters: {
          version: 3,
          match: 'all',
          amenities: [],
          beer_brands: ['pilsner-urquell'],
          beer_match: 'all',
        },
      }),
    })) as unknown as typeof fetch;

    await expect(
      searchPubsNear(50.08, 14.42, 25, undefined, {
        beerBrandKeys: ['pilsner-urquell', 'radegast'],
      }),
    ).rejects.toThrow('Pub directory backend is not configured or unavailable');
    expect(warning).toHaveBeenCalledWith('[pubs] backend did not acknowledge multi-brand filters');
  });

  it('passes amenity filters alongside a beer brand', async () => {
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [PUB_ITEM],
        applied_filters: {
          version: 1,
          match: 'all',
          amenities: ['payment_card', 'game_foosball'],
          beer_brand: 'pilsner-urquell',
        },
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchPubsNear(50.08, 14.42, 25, undefined, {
      beerBrandKey: 'pilsner-urquell',
      amenityKeys: ['payment_card', 'game_foosball'],
    });

    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(calledUrl.searchParams.get('beer_brand')).toBe('pilsner-urquell');
    expect(calledUrl.searchParams.get('amenities')).toBe('payment_card,game_foosball');
  });

  it('fails closed when an older backend ignores amenity filters', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      // Legacy backend shape: valid 200, but no applied_filters acknowledgement.
      json: async () => ({ items: [PUB_ITEM] }),
    })) as unknown as typeof fetch;

    await expect(
      searchPubsNear(50.08, 14.42, 25, undefined, {
        amenityKeys: ['payment_card'],
      }),
    ).rejects.toThrow('Pub directory backend is not configured or unavailable');
    expect(warning).toHaveBeenCalledWith('[pubs] backend did not acknowledge amenity filters');
  });

  it('feeds backend items through the existing filter pipeline (drops non-pubs)', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          PUB_ITEM,
          // Café under a screened label → dropped by the name heuristic.
          { name: 'Kavárna roh', label: 'Bar', position: { lat: 50.082, lon: 14.422 } },
        ],
      }),
    })) as unknown as typeof fetch;

    const pubs = await searchPubsNear(50.08, 14.42, 25);

    expect(pubs).toHaveLength(1);
    expect(pubs[0].name).toBe('Hospoda U Testu');
  });

  it('does not fall back to direct Mapy on a 503 from the backend', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => '',
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(searchPubsNear(50.08, 14.42, 25)).rejects.toThrow(
      'Pub directory backend is not configured or unavailable',
    );
    expect(calledUrls(fetchMock)[0]).toContain('/v1/pubs/near');
    expect(calledUrls(fetchMock).some((url) => url.startsWith('https://api.mapy.cz/'))).toBe(false);
    expect(warning).toHaveBeenCalledWith('[pubs] backend pubs/near HTTP 503');
  });

  it('does not fall back to direct Mapy on a backend network error', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const networkError = new Error('network down');
    setBackend('https://api.example.com');
    const fetchMock = jest.fn(async () => {
      throw networkError;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(searchPubsNear(50.08, 14.42, 25)).rejects.toThrow(
      'Pub directory backend is not configured or unavailable',
    );
    expect(calledUrls(fetchMock)[0]).toContain('/v1/pubs/near');
    expect(calledUrls(fetchMock).some((url) => url.startsWith('https://api.mapy.cz/'))).toBe(false);
    expect(warning).toHaveBeenCalledWith('[pubs] backend pubs/near failed:', networkError);
  });

  it('fails without any direct Mapy request when the backend is not configured', async () => {
    setBackend(undefined);
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(searchPubsNear(50.08, 14.42, 25)).rejects.toThrow(
      'Pub directory backend is not configured or unavailable',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates an honoured abort instead of falling back', async () => {
    setBackend('https://api.example.com');
    const controller = new AbortController();
    controller.abort();
    global.fetch = jest.fn(async () => {
      throw new DOMException('Aborted', 'AbortError');
    }) as unknown as typeof fetch;

    await expect(
      searchPubsNear(50.08, 14.42, 25, controller.signal),
    ).rejects.not.toThrow('Pub directory backend is not configured or unavailable');
  });
});

describe('geocodePubLocation', () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_BACKEND === undefined) {
      delete process.env.EXPO_PUBLIC_BACKEND_URL;
    } else {
      process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_BACKEND;
    }
    jest.clearAllMocks();
  });

  it('returns null without a backend geocode proxy', async () => {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      geocodePubLocation({
        name: 'Hospoda U Testu',
        city: 'Praha',
        address: 'Týnská ulička 610/7',
        near: { lat: 50.08, lng: 14.42 },
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the backend geocode proxy when configured', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Hospoda U Testu',
            label: 'Hospoda',
            type: 'poi',
            position: { lat: 50.081, lon: 14.421 },
            regionalStructure: [{ name: 'Praha', type: 'regional.municipality' }],
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await geocodePubLocation({
      name: 'Hospoda U Testu',
      city: 'Praha',
      near: { lat: 50.08, lng: 14.42 },
    });

    expect(result).toEqual({ lat: 50.081, lng: 14.421, city: 'Praha', address: undefined, type: 'poi' });
    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://api.example.com/v1/pubs/geocode');
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toEqual(expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(requestJson(fetchMock.mock.calls[0] as unknown[])).toEqual({
      query: 'Hospoda U Testu, Praha',
      lat: 50.08,
      lng: 14.42,
    });
    expect(calledUrl.search).toBe('');
  });

  it('passes a selected Google place id to the backend resolver', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Občerstvení U Smrku',
            type: 'regional.address',
            position: { lat: 50.080123, lon: 16.510616 },
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await geocodePubLocation({
      name: 'Občerstvení U Smrku',
      placeId: 'place-smrk',
      near: { lat: 50.08, lng: 16.51 },
    });

    expect(requestJson(fetchMock.mock.calls[0] as unknown[])).toEqual({
      query: 'Občerstvení U Smrku',
      place_id: 'place-smrk',
      lat: 50.08,
      lng: 16.51,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to an address-only geocode when the named pub is not a Mapy POI', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      const query = JSON.parse(String(init?.body ?? '{}')).query;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items:
            query === 'Testovací 12, Praha'
              ? [
                  {
                    name: 'Testovací 12',
                    type: 'regional.address',
                    position: { lat: 50.081, lon: 14.421 },
                    regionalStructure: [
                      { name: '12', type: 'regional.address' },
                      { name: 'Testovací', type: 'regional.street' },
                      { name: 'Praha', type: 'regional.municipality' },
                    ],
                  },
                ]
              : [
                  {
                    name: 'Praha',
                    type: 'regional.municipality',
                    position: { lat: 50.0755, lon: 14.4378 },
                  },
                ],
        }),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await geocodePubLocation({
      name: 'Hospoda mimo Mapy',
      city: 'Praha',
      address: 'Testovací 12',
      near: { lat: 50.08, lng: 14.42 },
    });

    expect(result).toEqual({
      lat: 50.081,
      lng: 14.421,
      city: 'Praha',
      address: 'Testovací 12',
      type: 'regional.address',
    });
    const queries = fetchMock.mock.calls.map((call) => requestJson(call as unknown[]).query);
    expect(queries).toEqual([
      'Hospoda mimo Mapy, Testovací 12, Praha',
      'Testovací 12, Praha',
    ]);
  });

  it('does not treat a street centroid as a precise geocode result', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Testovací',
            type: 'regional.street',
            position: { lat: 50.081, lon: 14.421 },
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await geocodePubLocation({
      name: 'Hospoda mimo Mapy',
      city: 'Praha',
      address: 'Testovací',
      near: { lat: 50.08, lng: 14.42 },
    });

    expect(result?.type).toBe('regional.street');
    expect(isSpecificGeocodeResult(result)).toBe(false);
  });

  it('does not fall back to direct Mapy geocode when the backend lookup is unavailable', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async (url: string) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/v1/pubs/geocode') {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        };
      }
      if (parsed.pathname === '/v1/client-events') {
        return {
          ok: true,
          status: 202,
          json: async () => ({}),
        };
      }
      throw new Error(`Unexpected direct request to ${parsed.toString()}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await geocodePubLocation({
      name: 'Hospoda U Testu',
      city: 'Praha',
      near: { lat: 50.08, lng: 14.42 },
    });

    expect(result).toBeNull();
    const calledUrls = fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])));
    const backendUrl = calledUrls.find((url) => url.pathname === '/v1/pubs/geocode');
    if (!backendUrl) throw new Error('Expected backend geocode call');
    expect(backendUrl.origin + backendUrl.pathname).toBe('https://api.example.com/v1/pubs/geocode');
    expect(calledUrls.some((url) => url.origin === 'https://api.mapy.cz')).toBe(false);
  });
});

describe('suggestPubLocations', () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_BACKEND === undefined) {
      delete process.env.EXPO_PUBLIC_BACKEND_URL;
    } else {
      process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_BACKEND;
    }
    jest.clearAllMocks();
  });

  it('returns selectable backend suggestions with address text', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Hospoda U Testu',
            label: 'Hospoda',
            type: 'poi',
            position: { lat: 50.081, lon: 14.421 },
            regionalStructure: [
              { name: '12', type: 'regional.address' },
              { name: 'Testovací', type: 'regional.street' },
              { name: 'Praha', type: 'regional.municipality' },
            ],
          },
          {
            name: 'Kafe v Presu',
            label: 'Bar',
            type: 'poi',
            position: { lat: 50.082, lon: 14.422 },
          },
          {
            name: 'Vinotéka & Vinárna U Dómu',
            label: 'Vinotéka',
            type: 'poi',
            position: { lat: 49.59715, lon: 17.26232 },
            regionalStructure: [
              { name: '861/3', type: 'regional.address' },
              { name: 'Komenského', type: 'regional.street' },
              { name: 'Olomouc', type: 'regional.municipality' },
            ],
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const suggestions = await suggestPubLocations({
      name: 'Hospoda U Te',
      near: { lat: 50.08, lng: 14.42 },
    });

    expect(suggestions).toEqual([
      {
        id: 'mapy:50.08100,14.42100:Hospoda U Testu',
        name: 'Hospoda U Testu',
        lat: 50.081,
        lng: 14.421,
        city: 'Praha',
        address: 'Testovací 12',
        location: 'Testovací 12, Praha',
      },
      {
        id: 'mapy:50.08200,14.42200:Kafe v Presu',
        name: 'Kafe v Presu',
        lat: 50.082,
        lng: 14.422,
        city: undefined,
        address: undefined,
        location: undefined,
      },
      {
        id: 'mapy:49.59715,17.26232:Vinotéka & Vinárna U Dómu',
        name: 'Vinotéka & Vinárna U Dómu',
        lat: 49.59715,
        lng: 17.26232,
        city: 'Olomouc',
        address: 'Komenského 861/3',
        location: 'Komenského 861/3, Olomouc',
      },
    ]);
    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://api.example.com/v1/pubs/suggest');
    expect(requestJson(fetchMock.mock.calls[0] as unknown[])).toEqual({
      query: 'Hospoda U Te',
      lat: 50.08,
      lng: 14.42,
    });
    expect(calledUrl.search).toBe('');
  });

  it('does not call the backend for very short queries', async () => {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(suggestPubLocations({ name: 'U' })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers the backend suggest proxy when configured', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Hospoda U Testu',
            label: 'Hospoda',
            position: { lat: 50.081, lon: 14.421 },
            location: 'Testovací 12, Praha',
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const suggestions = await suggestPubLocations({
      name: 'Hospoda U Te',
      near: { lat: 50.08, lng: 14.42 },
    });

    expect(suggestions).toEqual([
      {
        id: 'mapy:50.08100,14.42100:Hospoda U Testu',
        name: 'Hospoda U Testu',
        lat: 50.081,
        lng: 14.421,
        city: undefined,
        address: undefined,
        location: 'Testovací 12, Praha',
      },
    ]);
    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://api.example.com/v1/pubs/suggest');
    expect(requestJson(fetchMock.mock.calls[0] as unknown[])).toEqual({
      query: 'Hospoda U Te',
      lat: 50.08,
      lng: 14.42,
    });
    expect(calledUrl.search).toBe('');
  });

  it('keeps unresolved Google predictions selectable by place id', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'google:place-smrk',
            provider: 'google',
            providerPlaceId: 'place-smrk',
            name: 'Občerstvení U Smrku',
            location: 'Líšnice ev. č. 7, Líšnice',
            type: 'poi',
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const suggestions = await suggestPubLocations({
      name: 'Občerstvení U Smrku',
      near: { lat: 50.080123, lng: 16.510616 },
    });

    expect(suggestions).toEqual([
      {
        id: 'google:place-smrk',
        name: 'Občerstvení U Smrku',
        city: undefined,
        address: undefined,
        location: 'Líšnice ev. č. 7, Líšnice',
        provider: 'google',
        placeId: 'place-smrk',
      },
    ]);
  });

  it('does not fall back to direct Mapy suggestions when the backend lookup is unavailable', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async (url: string) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/v1/pubs/suggest') {
        return {
          ok: false,
          status: 503,
          json: async () => ({}),
        };
      }
      if (parsed.pathname === '/v1/client-events') {
        return {
          ok: true,
          status: 202,
          json: async () => ({}),
        };
      }
      throw new Error(`Unexpected direct request to ${parsed.toString()}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const suggestions = await suggestPubLocations({
      name: 'Hospoda U Te',
      near: { lat: 50.08, lng: 14.42 },
    });

    expect(suggestions).toEqual([]);
    const calledUrls = fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])));
    const backendUrl = calledUrls.find((url) => url.pathname === '/v1/pubs/suggest');
    if (!backendUrl) throw new Error('Expected backend suggest call');
    expect(backendUrl.origin + backendUrl.pathname).toBe('https://api.example.com/v1/pubs/suggest');
    expect(calledUrls.some((url) => url.origin === 'https://api.mapy.cz')).toBe(false);
  });
});

describe('reverseGeocodePubLocation', () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_BACKEND === undefined) {
      delete process.env.EXPO_PUBLIC_BACKEND_URL;
    } else {
      process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_BACKEND;
    }
  });

  it('returns editable city and address for a selected map point', async () => {
    process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            name: 'Líšnice ev. č. 7',
            type: 'regional.address',
            position: { lat: 50.080123, lon: 16.510616 },
            regionalStructure: [
              { name: 'Líšnice', type: 'regional.municipality' },
              { name: 'Líšnice ev. č. 7', type: 'regional.street' },
            ],
          },
        ],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await reverseGeocodePubLocation({
      lat: 50.080123,
      lng: 16.510616,
    });

    expect(result).toEqual({
      lat: 50.080123,
      lng: 16.510616,
      city: 'Líšnice',
      address: 'Líšnice ev. č. 7',
      type: 'regional.address',
    });
    const calledUrl = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(calledUrl.pathname).toBe('/v1/pubs/reverse-geocode');
    expect(requestJson(fetchMock.mock.calls[0] as unknown[])).toEqual({
      lat: 50.080123,
      lng: 16.510616,
    });
  });
});
