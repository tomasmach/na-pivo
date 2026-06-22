import { suggestBeerBrands } from '../beerSuggestionsClient';

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

describe('suggestBeerBrands', () => {
  it('returns empty results for short queries without fetching', async () => {
    setBackend('https://api.example.com');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(suggestBeerBrands('p')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses local fallback when the backend URL is unset', async () => {
    setBackend('   ');
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(suggestBeerBrands('plz')).resolves.toEqual([
      { slug: 'pilsner-urquell', name: 'Pilsner Urquell' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('GETs the backend suggestion endpoint and normalizes usable items', async () => {
    setBackend('https://api.example.com/');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        suggestions: [
          {
            slug: 'pilsner-urquell',
            name: 'Pilsner Urquell',
            kind: 'product',
            brand_slug: 'pilsner-urquell',
            brand_name: 'Pilsner Urquell',
          },
          { slug: '', name: 'Broken' },
          { slug: 'pilsner-urquell', name: 'Duplicate' },
          { slug: 'gambrinus-10', name: 'Gambrinus 10°', kind: 'product' },
        ],
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(suggestBeerBrands('plz', undefined, 2)).resolves.toEqual([
      {
        slug: 'pilsner-urquell',
        name: 'Pilsner Urquell',
        kind: 'product',
        brandSlug: 'pilsner-urquell',
        brandName: 'Pilsner Urquell',
      },
      { slug: 'gambrinus-10', name: 'Gambrinus 10°', kind: 'product' },
    ]);

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/beer-brands/suggest?q=plz&limit=2');
    expect(init.method).toBe('GET');
  });

  it('falls back locally on backend failures', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(suggestBeerBrands('kozel')).resolves.toEqual([
      { slug: 'velkopopovicky-kozel-10', name: 'Velkopopovický Kozel 10°' },
      { slug: 'velkopopovicky-kozel-11', name: 'Velkopopovický Kozel 11°' },
      { slug: 'velkopopovicky-kozel-12', name: 'Velkopopovický Kozel 12°' },
      { slug: 'velkopopovicky-kozel-cerny', name: 'Velkopopovický Kozel Černý' },
    ]);
  });

  it('returns empty results when aborted before fetch', async () => {
    setBackend('https://api.example.com');
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(suggestBeerBrands('plz', controller.signal)).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
