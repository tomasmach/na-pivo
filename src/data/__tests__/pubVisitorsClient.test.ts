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
  PUB_VISITORS_STORAGE_KEY,
  fetchPubVisitorsLastWeek,
  nextWeekStartsAt,
  parsePubVisitors,
  readKnownPubVisitors,
  resetPubVisitorsCache,
} from '../pubVisitorsClient';

describe('parsePubVisitors', () => {
  it('keeps positive whole counts and drops anything else', () => {
    const visitors = parsePubVisitors({
      week_start: '2026-09-14',
      week_end: '2026-09-20',
      pubs: { u2fkbn1z: 4, u2fkbq00: 0, u2fkbzzz: 1.5, u2fkbyyy: '3' },
    });

    expect(visitors && [...visitors]).toEqual([['u2fkbn1z', 4]]);
  });

  it('returns null for a malformed body', () => {
    expect(parsePubVisitors(null)).toBeNull();
    expect(parsePubVisitors({ pubs: [] })).toBeNull();
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
    resetPubVisitorsCache();
  });

  afterEach(() => jest.restoreAllMocks());

  async function loadThenRestartAppAt(time: number) {
    await fetchPubVisitorsLastWeek();
    resetPubVisitorsCache();
    fetchMock.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(time);
  }

  it('shows the week at once after a restart and skips a request while it is fresh', async () => {
    await loadThenRestartAppAt(NOW + HOUR);

    expect([...((await fetchPubVisitorsLastWeek()) ?? [])]).toEqual([['u2fkbn1z', 4]]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...((await readKnownPubVisitors()) ?? [])]).toEqual([['u2fkbn1z', 4]]);
  });

  it('refreshes a copy saved while the clock ran ahead within the usual three hours', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 48 * HOUR);
    await loadThenRestartAppAt(NOW);
    await readKnownPubVisitors();
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 3 * HOUR);

    await fetchPubVisitorsLastWeek();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still shows an older copy of the week while the request refreshes it', async () => {
    await loadThenRestartAppAt(NOW + 4 * HOUR);

    expect([...((await readKnownPubVisitors()) ?? [])]).toEqual([['u2fkbn1z', 4]]);
    await fetchPubVisitorsLastWeek();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never shows a copy once the next week has started', async () => {
    await loadThenRestartAppAt(Date.parse(ROLLOVER));

    await expect(readKnownPubVisitors()).resolves.toBeNull();
  });

  it('ignores an unreadable copy', async () => {
    await AsyncStorage.setItem(PUB_VISITORS_STORAGE_KEY, '{"pubs":');

    await expect(readKnownPubVisitors()).resolves.toBeNull();
    await AsyncStorage.setItem(PUB_VISITORS_STORAGE_KEY, JSON.stringify({ pubs: { u2fkbn1z: 4 } }));
    resetPubVisitorsCache();
    await expect(readKnownPubVisitors()).resolves.toBeNull();
  });
});
