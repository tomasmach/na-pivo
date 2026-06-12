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

import { isAcceptablePubName, searchPubsNear } from '../mapyClient';

const REST = 'Restaurace a pohostinství';
const BAR = 'Bar';

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

describe('searchPubsNear — backend-first with direct-Mapy fallback', () => {
  const ORIGINAL_FETCH = global.fetch;
  const ORIGINAL_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;

  // A raw Mapy suggest item — the same shape the backend returns in `items` and
  // the direct /v1/suggest returns in `items`. Picked so it survives itemToPub.
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

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    setBackend(ORIGINAL_BACKEND);
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
    // The backend's raw items run through itemToPub just like a direct fetch.
    expect(pubs).toHaveLength(1);
    expect(pubs[0].name).toBe('Hospoda U Testu');
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

  it('falls back to direct Mapy on a 503 from the backend', async () => {
    setBackend('https://api.example.com');
    // Backend returns 503 (no key / cap exhausted); the direct fallback then
    // throws because no Mapy API key is configured in the test env — which
    // proves the fallback path was taken.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => '',
    })) as unknown as typeof fetch;

    await expect(searchPubsNear(50.08, 14.42, 25)).rejects.toThrow(
      'MAPY_API_KEY is not configured',
    );
  });

  it('falls back to direct Mapy on a backend network error', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(searchPubsNear(50.08, 14.42, 25)).rejects.toThrow(
      'MAPY_API_KEY is not configured',
    );
  });

  it('skips straight to fallback when the backend is not configured', async () => {
    setBackend(undefined);
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    global.fetch = fetchMock as unknown as typeof fetch;

    // No backend + no Mapy key → throws, and the backend was never contacted.
    await expect(searchPubsNear(50.08, 14.42, 25)).rejects.toThrow(
      'MAPY_API_KEY is not configured',
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
    ).rejects.not.toThrow('MAPY_API_KEY is not configured');
  });
});
