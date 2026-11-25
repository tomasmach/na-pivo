import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useBeerMap } from '../useBeerMap';
import { useAccountStore } from '@/stores/accountStore';

const mockBoundary = new Set<() => void>();
let mockGeneration = 0;
let mockFocus: (() => void | (() => void)) | null = null;

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock') }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    mockFocus = effect;
  },
}));
jest.mock('expo-location', () => ({}));
jest.mock('@/compass/permissions', () => ({
  checkLocationPermission: jest.fn(async () => 'denied'),
  ensureLocationPermission: jest.fn(async () => 'denied'),
}));
jest.mock('@/location/locationCurrency', () => ({ updateCurrencyFromCoordinates: jest.fn() }));
jest.mock('@/data/pubs', () => ({
  fetchPubsNear: jest.fn(async () => undefined),
  getAllLoadedPubs: () => [],
  hydratePubsSnapshot: jest.fn(async () => undefined),
  isRestaurant: () => false,
}));
jest.mock('@/data/friendsClient', () => ({ fetchFriendsLive: jest.fn(async () => null) }));
jest.mock('@/data/friendsSnapshot', () => ({ loadFriendsDashboardSnapshot: jest.fn(async () => null) }));
jest.mock('@/data/visitsSnapshot', () => ({
  loadVisitsSnapshot: jest.fn(async () => []),
  saveVisitsSnapshot: jest.fn(async () => undefined),
  subscribeVisitsBoundary: (listener: () => void) => {
    mockBoundary.add(listener);
    return () => mockBoundary.delete(listener);
  },
  visitsSnapshotGeneration: () => mockGeneration,
}));
jest.mock('../mapModel', () => ({
  buildLivePubs: () => [],
  buildVisitedCities: () => [],
  buildVisitedPubs: (visits: { client_id: string }[]) => visits.map((visit) => ({ id: visit.client_id })),
}));


const filters = { amenityKeys: [] } as never;

function diary(accountId: string, ids: string[]) {
  return { accountId, data: { drinks: [], visits: ids.map((client_id) => ({ client_id })) } } as never;
}

it('shows the next account its diary visits when the map comes back into view', async () => {
  useAccountStore.setState({ session: { accountId: 'a' } as never, diarySnapshot: diary('a', ['a-1']) });
  const { result } = await renderHook(() => useBeerMap(filters));
  let blur: void | (() => void) = undefined;
  await act(() => {
    blur = mockFocus?.();
  });
  await waitFor(() => expect(result.current.visitedPubs).toHaveLength(1));

  await act(() => {
    (blur as unknown as () => void)?.();
    mockGeneration += 1;
    for (const listener of mockBoundary) listener();
  });
  await act(() => useAccountStore.setState({ session: { accountId: 'b' } as never, diarySnapshot: diary('b', ['b-1', 'b-2']) }));
  expect(result.current.visitedPubs).toHaveLength(0);

  await act(() => {
    mockFocus?.();
  });
  await waitFor(() => expect(result.current.visitedPubs.map((pub) => (pub as unknown as { id: string }).id)).toEqual(['b-1', 'b-2']));
});
