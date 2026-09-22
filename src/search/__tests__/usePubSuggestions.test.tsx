import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { geohash8 } from '@/data/geohash';
import { loadVisitsSnapshot, clearVisitsSnapshot } from '@/data/visitsSnapshot';
import type { WireVisit } from '@/data/visitsClient';
import { usePubSuggestions } from '../usePubSuggestions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockPub = { id: 'local', name: 'U Testu', lat: 49.2, lng: 16.6 };
const mockPubs = [mockPub];
const mockHistory: never[] = [];
const mockReported: string[] = [];
const mockAccount = { session: { accountId: 'account-1' }, diarySnapshot: null };
const mockAppStateListeners = new Set<(state: string) => void>();
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => {
    mockAppStateListeners.add(listener);
    return { remove: () => mockAppStateListeners.delete(listener) };
  } },
}));
jest.mock('expo-router', () => ({ useFocusEffect: (effect: () => (() => void)) => React.useEffect(effect, [effect]) }));
jest.mock('expo-location', () => ({ getForegroundPermissionsAsync: jest.fn(), getLastKnownPositionAsync: jest.fn(), requestForegroundPermissionsAsync: jest.fn() }));
jest.mock('@/data/pubs', () => ({ getAllLoadedPubs: () => mockPubs, hydratePubsSnapshot: async () => true }));
jest.mock('@/stores/pubStore', () => ({ usePubStore: (selector: (state: unknown) => unknown) => selector({ catalogRevision: 0, reportedPubIds: mockReported, reportedCacheKeys: mockReported }) }));
jest.mock('@/stores/tallyStore', () => ({ useTallyStore: (selector: (state: unknown) => unknown) => selector({ current: null, history: mockHistory }), allSessionsNewestFirst: () => mockHistory }));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: (selector: (state: unknown) => unknown) => selector(mockAccount) }));
jest.mock('@/data/visitsSnapshot', () => {
  const actual = jest.requireActual('@/data/visitsSnapshot');
  return { ...actual, loadVisitsSnapshot: jest.fn(async () => []) };
});

const visit: WireVisit = { client_id: 'visit-1', cache_key: geohash8(mockPub.lat, mockPub.lng), name: mockPub.name,
  lat: mockPub.lat, lng: mockPub.lng, city: null, external_id: mockPub.id,
  started_at: '2026-09-20T18:00:00Z', ended_at: null, updated_at: '2026-09-20T18:00:00Z' };
const fix = () => ({ coords: { latitude: 49.2, longitude: 16.6, accuracy: 10 }, timestamp: Date.now() }) as Location.LocationObject;
let latest: ReturnType<typeof usePubSuggestions>;
let renderer: TestRenderer.ReactTestRenderer;
function Probe() {
  const result = usePubSuggestions();
  React.useEffect(() => { latest = result; }, [result]);
  return null;
}
async function mount() { await act(async () => { renderer = TestRenderer.create(<Probe />); }); }
async function appState(state: 'active' | 'background') {
  await act(async () => {
    AppState.currentState = state;
    for (const listener of mockAppStateListeners) listener(state);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-22T16:00:00Z'));
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'granted' } as Location.LocationPermissionResponse);
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue(fix());
  jest.mocked(loadVisitsSnapshot).mockResolvedValue([]);
});
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });

it('reads only a recent cached fix and never requests permission', async () => {
  await mount();
  expect(latest.nearby[0].pub.id).toBe('local');
  expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({ maxAge: 300000, requiredAccuracy: 100 });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(300001); });
  expect(latest.nearby).toEqual([]);
});

it.each(['denied', 'undetermined'])('uses history without reading GPS or prompting when permission is %s', async (status) => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status } as Location.LocationPermissionResponse);
  jest.mocked(loadVisitsSnapshot).mockResolvedValue([visit]);
  await mount();
  expect(latest.nearby).toEqual([]);
  expect(latest.frequent[0].visitCount).toBe(1);
  expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

it('ignores a stale native fix and tolerates an unavailable permission read', async () => {
  jest.mocked(Location.getLastKnownPositionAsync).mockResolvedValue({ ...fix(), timestamp: Date.now() - 300001 });
  await mount();
  expect(latest.nearby).toEqual([]);
  jest.mocked(Location.getForegroundPermissionsAsync).mockRejectedValue(new Error('unavailable'));
  await appState('background');
  await appState('active');
  expect(latest.nearby).toEqual([]);
});

it('does not restore a delayed GPS fix after backgrounding or revoked permission', async () => {
  let resolve!: (value: Location.LocationObject) => void;
  jest.mocked(Location.getLastKnownPositionAsync).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await mount();
  await appState('background');
  await act(async () => { resolve(fix()); });
  expect(latest.nearby).toEqual([]);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'denied' } as Location.LocationPermissionResponse);
  await appState('active');
  expect(latest.nearby).toEqual([]);
});

it('drops displayed and pending private history at the account boundary', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue({ status: 'denied' } as Location.LocationPermissionResponse);
  jest.mocked(loadVisitsSnapshot).mockResolvedValue([visit]);
  await mount();
  expect(latest.frequent).toHaveLength(1);
  await act(async () => { await clearVisitsSnapshot(); });
  expect(latest.frequent).toEqual([]);
  act(() => renderer.unmount());
  let resolve!: (value: WireVisit[]) => void;
  jest.mocked(loadVisitsSnapshot).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await mount();
  await act(async () => { await clearVisitsSnapshot(); resolve([visit]); });
  expect(latest.frequent).toEqual([]);
});
