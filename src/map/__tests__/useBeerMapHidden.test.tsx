import { act, renderHook } from '@testing-library/react-native';

import { EMPTY_PUB_SEARCH_FILTERS } from '@/data/pubSearchFilters';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';

import { useBeerMap } from '../useBeerMap';

let mockFocused = true;

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      const focused = mockFocused;
      useEffect(() => (focused ? effect() : undefined), [focused, effect]);
    },
  };
});
jest.mock('expo-location', () => ({}));
jest.mock('@/compass/permissions', () => ({
  checkLocationPermission: jest.fn(() => Promise.resolve('denied')),
  ensureLocationPermission: jest.fn(() => Promise.resolve('denied')),
}));
jest.mock('@/data/pubs', () => ({
  fetchPubsNear: jest.fn(() => Promise.resolve({ pubs: [] })),
  getAllLoadedPubs: jest.fn(() => []),
  hydratePubsSnapshot: jest.fn(() => Promise.resolve()),
  isRestaurant: jest.fn(() => false),
}));
jest.mock('@/data/friendsClient', () => ({ fetchFriendsLive: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/data/friendsSnapshot', () => ({ loadFriendsDashboardSnapshot: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/data/visitsSnapshot', () => ({
  loadVisitsSnapshot: jest.fn(() => Promise.resolve([])),
  saveVisitsSnapshot: jest.fn(() => Promise.resolve()),
  subscribeVisitsBoundary: jest.fn(() => () => undefined),
  visitsSnapshotGeneration: jest.fn(() => 0),
}));
jest.mock('@/location/locationCurrency', () => ({ updateCurrencyFromCoordinates: jest.fn() }));

function evening(drinks: number): TallySession {
  return {
    clientId: 'evening-1',
    pubKey: 'u2fkbnjj',
    pubName: 'U Zlatého tygra',
    startedAt: '2026-11-14T18:00:00.000Z',
    drinks: Array.from({ length: drinks }, (_, i) => ({ id: `drink-${i}`, beerName: 'Pilsner', at: `2026-11-14T18:${String(10 + i)}:00.000Z` })),
  };
}

async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

describe('useBeerMap on a hidden tab', () => {
  beforeEach(() => {
    mockFocused = true;
    useTallyStore.setState({ current: evening(1), history: [] });
  });

  it('does not redraw for a beer logged elsewhere and catches up when it shows again', async () => {
    let renders = 0;
    const { result, rerender } = await renderHook(() => {
      renders += 1;
      return useBeerMap(EMPTY_PUB_SEARCH_FILTERS);
    });
    await settle();
    const firstVisit = result.current.visitedPubs[0]?.lastVisitedAt;
    expect(firstVisit).toBe('2026-11-14T18:10:00.000Z');

    mockFocused = false;
    await rerender({});
    await settle();
    const hiddenRenders = renders;

    await act(async () => {
      useTallyStore.setState({ current: evening(2) });
    });
    await settle();
    expect(renders).toBe(hiddenRenders);

    mockFocused = true;
    await rerender({});
    await settle();
    expect(result.current.visitedPubs[0]?.lastVisitedAt).toBe('2026-11-14T18:11:00.000Z');
  });
});
