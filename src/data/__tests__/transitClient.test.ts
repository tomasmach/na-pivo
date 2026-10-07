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
  TRANSIT_STOPS_STORAGE_KEY,
  fetchLastDirectDeparture,
  loadTransitStops,
  parseLastDirect,
  parseTransitStops,
  resetTransitClientCache,
} from '../transitClient';

const fetchMock = jest.fn();

beforeEach(async () => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  resetTransitClientCache();
  await AsyncStorage.clear();
});

describe('parseTransitStops', () => {
  it('keeps well-formed rows only', () => {
    expect(
      parseTransitStops({
        stops: [['U1Z1P', 50.1, 14.4], ['bad', '50', 14], ['U2Z1P', 95, 14], 'x', ['U3Z1P', 50.2, 14.5]],
      }),
    ).toEqual([
      { id: 'U1Z1P', lat: 50.1, lng: 14.4 },
      { id: 'U3Z1P', lat: 50.2, lng: 14.5 },
    ]);
    expect(parseTransitStops({})).toBeNull();
  });
});

describe('parseLastDirect', () => {
  it('reads a departure, an empty night and rejects a malformed body', () => {
    expect(
      parseLastDirect({
        departure: {
          line: '9',
          headsign: 'Spojovací',
          route_type: 0,
          from_stop_id: 'U1Z1P',
          from_stop_name: 'Anděl',
          to_stop_id: 'U2Z1P',
          to_stop_name: 'Florenc',
          departs_at: '2026-10-07T23:58:00+02:00',
        },
      }),
    ).toEqual({
      line: '9',
      headsign: 'Spojovací',
      routeType: 0,
      fromStopId: 'U1Z1P',
      fromStopName: 'Anděl',
      toStopId: 'U2Z1P',
      toStopName: 'Florenc',
      departsAtMs: Date.parse('2026-10-07T21:58:00Z'),
    });
    expect(parseLastDirect({ departure: null })).toBeNull();
    expect(parseLastDirect({ departure: { departs_at: 'later' } })).toBeUndefined();
    expect(parseLastDirect({})).toBeUndefined();
  });
});

describe('loadTransitStops', () => {
  it('downloads once and answers later calls from the phone', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ feed_version: 'v1', stops: [['U1Z1P', 50.1, 14.4]] }),
    });

    expect(await loadTransitStops()).toEqual([{ id: 'U1Z1P', lat: 50.1, lng: 14.4 }]);
    // Another app run reads the copy from the device instead of the network.
    resetTransitClientCache();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await loadTransitStops()).toEqual([{ id: 'U1Z1P', lat: 50.1, lng: 14.4 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(TRANSIT_STOPS_STORAGE_KEY)).toContain('U1Z1P');
  });

  it('returns null without a list and does not retry on every call', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    expect(await loadTransitStops()).toBeNull();
    expect(await loadTransitStops()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetchLastDirectDeparture', () => {
  it('sends the pub point and stop ids, nothing else', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ departure: null }) });

    const result = await fetchLastDirectDeparture({
      fromLat: 50.07123456,
      fromLng: 14.40345678,
      toStopIds: ['U1Z1P', 'U2Z2P'],
    });

    expect(result).toEqual({ ok: true, departure: null });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8012/v1/transit/last-direct?from_lat=50.07123&from_lng=14.40346&to_stop_ids=U1Z1P,U2Z2P',
    );
  });

  it('reports a failure instead of throwing', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(
      fetchLastDirectDeparture({ fromLat: 50, fromLng: 14, toStopIds: ['U1Z1P'] }),
    ).resolves.toEqual({ ok: false });
  });
});
