import { fetchFavorites, submitFavorite } from '../pubFavoritesClient';

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `https://api.example.test${path}`,
}));
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 't', authenticated: false })),
  clearCachedAnonymousAccount: jest.fn(async () => false),
}));

const payload = { name: 'U Tygra', lat: 50.08, lng: 14.42, favorite: true, updated_at: '2026-09-28T12:00:00Z' };

describe('pubFavoritesClient', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('keeps an over-cap save for a retry instead of dropping it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 409 });
    await expect(submitFavorite(payload)).resolves.toBe('retry');
  });

  it('drops a payload the server rejects as invalid', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 400 });
    await expect(submitFavorite(payload)).resolves.toBe('permanent-error');
  });

  it('parses only well-formed favourites', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        favorites: [
          { cache_key: 'u2fkbnjj', name: 'U Tygra', lat: 50.08, lng: 14.42, external_id: '', updated_at: '2026-09-28T12:00:00Z' },
          { cache_key: 'broken' },
        ],
      }),
    });
    await expect(fetchFavorites()).resolves.toEqual({
      favorites: [expect.objectContaining({ cache_key: 'u2fkbnjj' })],
      removed: [],
    });
  });

  it('parses removals and ignores malformed ones', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        favorites: [],
        removed: [{ cache_key: 'u2fkbnjj', updated_at: '2026-09-28T12:00:00Z' }, { cache_key: 1 }],
      }),
    });
    await expect(fetchFavorites()).resolves.toEqual({
      favorites: [],
      removed: [{ cache_key: 'u2fkbnjj', updated_at: '2026-09-28T12:00:00Z' }],
    });
  });
});
