jest.mock('../account', () => ({
  clearCachedAnonymousAccount: jest.fn(),
  ensureAccount: jest.fn(async () => ({ token: 'token' })),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}`,
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

import { clearPubBoardCache, fetchPubBoard, parsePubBoard } from '../pubBoardClient';

const ENTRY = {
  rank: 1,
  cache_key: 'u2cvp000',
  name: 'Pegas',
  city: 'Brno',
  lat: 49.1967,
  lng: 16.6071,
  beers: 143,
};

describe('parsePubBoard', () => {
  it('reads the board and skips broken entries', () => {
    const board = parsePubBoard(
      {
        period: 'year',
        period_start: '2026-01-01',
        period_end: '2026-09-28',
        city: 'Brno',
        cities: [{ name: 'Brno', beers: 143 }, { name: '' }],
        total_ranked: 1,
        entries: [ENTRY, { ...ENTRY, name: ' ' }, { ...ENTRY, beers: 0 }, null],
      },
      'week',
    );

    expect(board).toEqual({
      period: 'year',
      periodStart: '2026-01-01',
      periodEnd: '2026-09-28',
      city: 'Brno',
      cities: [{ name: 'Brno', beers: 143 }],
      totalRanked: 1,
      entries: [
        { rank: 1, key: 'u2cvp000', name: 'Pegas', city: 'Brno', lat: 49.1967, lng: 16.6071, beers: 143 },
      ],
    });
  });

  it('returns null without entries', () => {
    expect(parsePubBoard(null, 'week')).toBeNull();
    expect(parsePubBoard({ period: 'week' }, 'week')).toBeNull();
  });
});

describe('fetchPubBoard', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    clearPubBoardCache();
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ period: 'all', city: 'Brno', entries: [ENTRY] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('asks for one window and city and remembers the answer', async () => {
    expect((await fetchPubBoard('all', 'Brno'))?.entries).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8012/v1/pubs/beer-board?period=all&city=Brno',
    );

    await fetchPubBoard('all', 'Brno');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fetchPubBoard('all', 'Brno', { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the server fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await fetchPubBoard('week', null)).toBeNull();
  });
});
