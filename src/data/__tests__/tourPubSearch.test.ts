import AsyncStorage from '@react-native-async-storage/async-storage';
import { cachedTourPubs, filterTourPubs, searchTourPubs } from '../tourPubSearch';
import { geocodePubLocation } from '../mapyClient';
import { getAllLoadedPubs } from '../pubs';
import { geohash8 } from '../geohash';
import { usePubStore } from '@/stores/pubStore';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

jest.mock('../apiFetch', () => ({ chainAbortSignal: (signal?: AbortSignal) => ({ signal: signal ?? new AbortController().signal, cleanup: jest.fn() }) }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: () => 'http://localhost:8012/v1/pubs/search' }));
jest.mock('../mapyClient', () => ({ geocodePubLocation: jest.fn(async () => null) }));
jest.mock('../pubs', () => ({ getAllLoadedPubs: jest.fn(() => []), hydratePubsSnapshot: jest.fn(async () => true) }));

const center = { latitude: 49.195, longitude: 16.607 };
const pub = { id: 'public-pub', name: 'Výčep Praha', lat: 50.08, lon: 14.42, address: 'Praha 1' };
const fetchMock = jest.fn();
beforeEach(async () => { await AsyncStorage.clear(); usePubStore.setState({ reportedPubIds: [], reportedCacheKeys: [] }); jest.mocked(getAllLoadedPubs).mockReturnValue([]); fetchMock.mockReset(); (geocodePubLocation as jest.Mock).mockReset(); global.fetch = fetchMock; });
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


it('filters non-pubs and reported identities from retained, loaded and persisted offline places', async () => {
  const snapshot = { ...pub, lng: pub.lon };
  const nonPub = { ...snapshot, id: 'shop', venueKind: 'not_pub' as const, lat: 49.1 };
  const reported = { ...snapshot, id: 'reported', lat: 49.2 };
  const renamed = { ...snapshot, id: 'new-provider-id', lat: 49.3 };
  const allowed = { ...snapshot, id: 'allowed', lat: 49.4 };
  jest.mocked(getAllLoadedPubs).mockReturnValue([nonPub, allowed]);
  await AsyncStorage.setItem('tour-pub-search-v1', JSON.stringify([nonPub, reported, renamed, allowed]));
  usePubStore.setState({ reportedPubIds: [reported.id], reportedCacheKeys: [geohash8(renamed.lat, renamed.lng)] });
  // A tour stop's older snapshot must not resurrect a newer not_pub verdict.
  expect((await cachedTourPubs('', [{ ...nonPub, venueKind: undefined }])).map((p) => p.id)).toEqual(['allowed']);
  fetchMock.mockRejectedValue(new TypeError('Offline'));
  expect((await searchTourPubs({ query: 'Výčep', center })).pubs.map((p) => p.id)).toEqual(['allowed']);
});

it('filters online results by current reports and preserves non-pub verdicts in the public cache', async () => {
  const nonPub = { ...pub, id: 'shop', venueKind: 'not_pub', lat: 49.1 };
  const reported = { ...pub, id: 'reported', lat: 49.2 };
  const renamed = { ...pub, id: 'new-provider-id', lat: 49.3 };
  const allowed = { ...pub, id: 'allowed', lat: 49.4 };
  fetchMock.mockImplementation(async () => {
    usePubStore.setState({ reportedPubIds: [reported.id], reportedCacheKeys: [geohash8(renamed.lat, renamed.lon)] });
    return response([nonPub, reported, renamed, allowed]);
  });
  expect((await searchTourPubs({ query: 'Výčep', center })).pubs.map((p) => p.id)).toEqual(['allowed']);
  expect((await cachedTourPubs()).map((p) => p.id)).toEqual(['allowed']);
  usePubStore.setState({ reportedPubIds: [], reportedCacheKeys: [] });
  expect((await cachedTourPubs()).map((p) => p.id)).toEqual(['reported', 'new-provider-id', 'allowed']);
});

it('rechecks personal exclusions for results already held by an open picker', () => {
  const loaded = [{ ...pub, lng: pub.lon }];
  expect(filterTourPubs(loaded)).toHaveLength(1);
  usePubStore.setState({ reportedCacheKeys: [geohash8(pub.lat, pub.lon)] });
  expect(filterTourPubs(loaded)).toEqual([]);
});


it('retains a non-pub verdict after another search and a restart with an old tour stop', async () => {
  fetchMock.mockResolvedValueOnce(response([{ ...pub, venueKind: 'not_pub' }]));
  await searchTourPubs({ query: 'Výčep', center });
  const other = { ...pub, id: 'other-pub', name: 'Jiná hospoda', lat: 49.5 };
  fetchMock.mockResolvedValueOnce(response([other]));
  await searchTourPubs({ query: 'Jiná', center });
  jest.mocked(getAllLoadedPubs).mockReturnValue([]);
  const retainedStop = { ...pub, lng: pub.lon };
  expect((await cachedTourPubs('', [retainedStop])).map((p) => p.id)).toEqual(['other-pub']);
});

it('matches all offline name and city terms regardless of order, accents or commas', async () => {
  fetchMock.mockResolvedValue(response([{ ...pub, name: 'U Jelena', city: 'Praha', address: 'Dlouhá 5' }]));
  await searchTourPubs({ query: 'Jelena, Praha', center });
  fetchMock.mockRejectedValue(new TypeError('Offline'));
  expect((await searchTourPubs({ query: 'Praha,  jelena dlouha', center })).pubs.map((p) => p.id)).toEqual([pub.id]);
  expect(await cachedTourPubs('Jelena, Brno')).toEqual([]);
});
