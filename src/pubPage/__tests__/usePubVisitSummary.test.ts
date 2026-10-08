import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockBoundary = new Set<() => void>();
let mockGeneration = 0;
const mockVisits = [{ name: 'U Anděla', external_id: null, cache_key: 'u2fkbn7s', visits: 3, last_visit: '2026-10-01T18:00:00Z' }];

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock') }));
jest.mock('@/data/visitsSnapshot', () => ({
  loadVisitsSnapshot: jest.fn(async () => mockVisits),
  subscribeVisitsBoundary: (listener: () => void) => {
    mockBoundary.add(listener);
    return () => mockBoundary.delete(listener);
  },
  visitsSnapshotGeneration: () => mockGeneration,
}));
jest.mock('@/map/mapModel', () => ({
  buildVisitedPubs: (visits: unknown[]) => visits.map(() => ({ cacheKey: 'u2fkbn7s' })),
}));

import { usePubVisitSummary } from '../usePubVisitSummary';
import { useAccountStore } from '@/stores/accountStore';

const pub = { id: '', name: 'U Anděla', lat: 50.07, lng: 14.4 };

it('shows the next account its own visits after the previous one was cleared', async () => {
  useAccountStore.setState({ session: { accountId: 'account-a' } as never });
  const { result } = renderHook(() => usePubVisitSummary(pub, 'u2fkbn7s'));
  await waitFor(() => expect(result.current).not.toBeNull());

  act(() => {
    mockGeneration += 1;
    for (const listener of mockBoundary) listener();
  });
  expect(result.current).toBeNull();

  act(() => useAccountStore.setState({ session: { accountId: 'account-b' } as never }));
  await waitFor(() => expect(result.current).not.toBeNull());
});
