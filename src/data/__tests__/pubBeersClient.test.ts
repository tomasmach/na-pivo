import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../account', () => ({
  clearCachedAnonymousAccount: jest.fn(),
  ensureAccount: jest.fn(async () => ({ token: 'token' })),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}`,
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

import {
  PUB_BEERS_STORAGE_KEY,
  fetchPubBeersLastWeek,
  nextWeekStartsAt,
  parsePubBeers,
  resetPubBeersCache,
} from '../pubBeersClient';

describe('parsePubBeers', () => {
  it('keeps positive whole counts and drops anything else', () => {
    const beers = parsePubBeers({
      week_start: '2026-09-14',
      week_end: '2026-09-20',
      pubs: { u2fkbn1z: 4, u2fkbq00: 0, u2fkbzzz: 1.5, u2fkbyyy: '3' },
    });

    expect(beers && [...beers]).toEqual([['u2fkbn1z', 4]]);
  });

  it('returns null for a malformed body', () => {
    expect(parsePubBeers(null)).toBeNull();
    expect(parsePubBeers({ pubs: [] })).toBeNull();
  });
});

describe('nextWeekStartsAt', () => {
  it('reads the rollover instant the server sends', () => {
    expect(
      new Date(nextWeekStartsAt({ next_week_starts_at: '2026-09-28T00:00:00+02:00' })!).toISOString(),
    ).toBe('2026-09-27T22:00:00.000Z');
    expect(nextWeekStartsAt({ next_week_starts_at: 'nonsense' })).toBeNull();
    expect(nextWeekStartsAt({})).toBeNull();
  });
});

describe('counts kept on the device', () => {
  const NOW = Date.parse('2026-09-23T10:00:00Z');
  const ROLLOVER = '2026-09-28T00:00:00+02:00';
  const HOUR = 60 * 60 * 1000;
  const fetchMock = jest.fn();

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    fetchMock.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ next_week_starts_at: ROLLOVER, pubs: { u2fkbn1z: 4 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await AsyncStorage.clear();
    resetPubBeersCache();
  });

  afterEach(() => jest.restoreAllMocks());

  async function loadThenRestartAppAt(time: number) {
    await fetchPubBeersLastWeek();
    resetPubBeersCache();
    fetchMock.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(time);
  }

  it('shows the counts right after a restart without a request', async () => {
    await loadThenRestartAppAt(NOW + 2 * HOUR);

    expect([...((await fetchPubBeersLastWeek()) ?? [])]).toEqual([['u2fkbn1z', 4]]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads them again once three hours have passed', async () => {
    await loadThenRestartAppAt(NOW + 3 * HOUR);

    await fetchPubBeersLastWeek();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads them again once the next week has started', async () => {
    const lateSunday = Date.parse(ROLLOVER) - HOUR;
    jest.spyOn(Date, 'now').mockReturnValue(lateSunday);
    await loadThenRestartAppAt(Date.parse(ROLLOVER));

    await fetchPubBeersLastWeek();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a copy saved while the clock ran ahead for three hours at most', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 48 * HOUR);
    await loadThenRestartAppAt(NOW);
    await fetchPubBeersLastWeek();
    expect(fetchMock).not.toHaveBeenCalled();

    jest.spyOn(Date, 'now').mockReturnValue(NOW + 3 * HOUR);
    await fetchPubBeersLastWeek();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores an unreadable copy', async () => {
    await AsyncStorage.setItem(PUB_BEERS_STORAGE_KEY, '{"pubs":');

    expect([...((await fetchPubBeersLastWeek()) ?? [])]).toEqual([['u2fkbn1z', 4]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
