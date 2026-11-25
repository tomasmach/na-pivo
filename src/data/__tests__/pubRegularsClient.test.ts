jest.mock('../account', () => ({
  clearCachedAnonymousAccount: jest.fn(),
  ensureAccount: jest.fn(async () => ({ token: 'token' })),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}`,
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

import { fetchPubRegulars, parsePubRegulars } from '../pubRegularsClient';

const ENTRY = {
  rank: 1,
  beers: 38,
  is_me: false,
  is_friend: true,
  account: { id: 'a1', nickname: 'pepa', display_name: 'Pepa', avatar_url: null, is_public: true },
};

describe('parsePubRegulars', () => {
  it('reads the order and my standing, skipping broken rows', () => {
    const regulars = parsePubRegulars(
      {
        period: 'year',
        total_ranked: 4,
        entries: [ENTRY, { ...ENTRY, account: { id: 'a2' } }, null],
        me: { beers: 11, rank: 9, listed: false, opted_in: false, eligible: true, ghost: false },
      },
      '30d',
    );

    expect(regulars).toEqual({
      period: 'year',
      totalRanked: 4,
      entries: [{ rank: 1, beers: 38, isMe: false, isFriend: true, account: { id: 'a1', nickname: 'pepa', displayName: 'Pepa', avatarUrl: null } }],
      me: { beers: 11, rank: 9, listed: false, optedIn: false, eligible: true, ghost: false },
    });
  });

  it('treats a missing me as not listed and not eligible', () => {
    expect(parsePubRegulars({ entries: [] }, '30d')?.me).toEqual({ beers: 0, rank: null, listed: false, optedIn: false, eligible: false, ghost: false });
    expect(parsePubRegulars({ period: '30d' }, '30d')).toBeNull();
  });
});

describe('fetchPubRegulars', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('asks the server on every open, so a listing turned off never lingers', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ period: '30d', entries: [ENTRY], me: {} }) });

    await fetchPubRegulars('u2fkbn1z', '30d');
    await fetchPubRegulars('u2fkbn1z', '30d');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8012/v1/pubs/regulars?cache_key=u2fkbn1z&period=30d');
  });

  it('returns null on a server error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await fetchPubRegulars('u2fkbn1z', 'all')).toBeNull();
  });
});
