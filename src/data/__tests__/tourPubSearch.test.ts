import AsyncStorage from '@react-native-async-storage/async-storage';
import { cachedTourPubs, searchTourPubs } from '../tourPubSearch';
import { geocodePubLocation } from '../mapyClient';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('../apiFetch', () => ({ chainAbortSignal: (signal?: AbortSignal) => ({ signal: signal ?? new AbortController().signal, cleanup: jest.fn() }) }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: () => 'http://localhost:8012/v1/pubs/search' }));
jest.mock('../mapyClient', () => ({ geocodePubLocation: jest.fn(async () => null) }));
jest.mock('../pubs', () => ({ getAllLoadedPubs: () => [], hydratePubsSnapshot: jest.fn(async () => true) }));

const center = { latitude: 49.195, longitude: 16.607 };
const pub = { id: 'public-pub', name: 'Výčep Praha', lat: 50.08, lon: 14.42, address: 'Praha 1' };
const fetchMock = jest.fn();
beforeEach(async () => { await AsyncStorage.clear(); fetchMock.mockReset(); (geocodePubLocation as jest.Mock).mockReset(); global.fetch = fetchMock; });
const response = (items: unknown[]) => ({ ok: true, json: async () => ({ items }) });

it('searches names outside the current map area and preserves public identity', async () => {
  fetchMock.mockResolvedValue(response([pub]));
  const result = await searchTourPubs({ query: 'Výčep Praha', center });
  expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8012/v1/pubs/search?q=V%C3%BD%C4%8Dep%20Praha');
  expect(result).toMatchObject({ status: 'ok', pubs: [{ id: 'public-pub', lng: 14.42 }], center: { latitude: 50.08, longitude: 14.42 } });
});

it('loads new area only using explicit area parameters', async () => {
  fetchMock.mockResolvedValue(response([]));
  const result = await searchTourPubs({ query: '', center, area: true });
  expect(fetchMock.mock.calls[0][0]).toContain('q=&lat=49.195&lon=16.607&radius_km=5');
  expect(result).toEqual({ pubs: [], status: 'ok', center: undefined });
  expect(geocodePubLocation).not.toHaveBeenCalled();
});

it('resolves a city then searches its directory without treating a centroid as a pub', async () => {
  fetchMock.mockResolvedValueOnce(response([])).mockResolvedValueOnce(response([pub]));
  (geocodePubLocation as jest.Mock).mockResolvedValue({ lat: 50.08, lng: 14.42, type: 'regional.municipality' });
  const result = await searchTourPubs({ query: 'Praha', center });
  expect(fetchMock.mock.calls[1][0]).toContain('lat=50.08&lon=14.42');
  expect(result.pubs).toHaveLength(1);
  expect(result.pubs[0].name).toBe('Výčep Praha');
});

it('never shows random nearby places for a name that geocodes to an address', async () => {
  fetchMock.mockResolvedValueOnce(response([]));
  (geocodePubLocation as jest.Mock).mockResolvedValue({ lat: 50.08, lng: 14.42, type: 'regional.address' });
  expect((await searchTourPubs({ query: 'Neznámá hospoda', center })).pubs).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('keeps cached places usable offline and searches with or without Czech accents', async () => {
  fetchMock.mockResolvedValue(response([pub]));
  await searchTourPubs({ query: 'Výčep', center });
  fetchMock.mockRejectedValue(new TypeError('Network request failed'));
  const result = await searchTourPubs({ query: 'vycep', center });
  expect(result).toMatchObject({ status: 'cached', pubs: [{ name: 'Výčep Praha' }] });
  expect((await cachedTourPubs('praha'))[0]).not.toHaveProperty('isOpenNow');
});

it('distinguishes a server failure from an empty result', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 503 });
  expect((await searchTourPubs({ query: 'Praha', center })).status).toBe('error');
});

it('ignores invalid persisted coordinates and malformed storage', async () => {
  await AsyncStorage.setItem('tour-pub-search-v1', '[{"id":"bad","name":"Bad","lat":999,"lng":14}]');
  expect(await cachedTourPubs()).toEqual([]);
  await AsyncStorage.setItem('tour-pub-search-v1', '{broken');
  expect(await cachedTourPubs()).toEqual([]);
});

it('does not fetch or return results for a cancelled query', async () => {
  const controller = new AbortController(); controller.abort();
  expect((await searchTourPubs({ query: 'Praha', center, signal: controller.signal })).status).toBe('cancelled');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects a response that arrives after cancellation even if fetch ignores abort', async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation(async () => { controller.abort(); return response([pub]); });
  expect((await searchTourPubs({ query: 'Praha', center, signal: controller.signal })).status).toBe('cancelled');
  expect(await cachedTourPubs()).toEqual([]);
});


it('refreshes a known pub instead of restoring its older cached name', async () => {
  fetchMock.mockResolvedValueOnce(response([pub]));
  await searchTourPubs({ query: 'Výčep', center });
  fetchMock.mockResolvedValueOnce(response([{ ...pub, name: 'Nový výčep' }]));
  await searchTourPubs({ query: 'Nový výčep', center });
  expect((await cachedTourPubs())[0].name).toBe('Nový výčep');
});
