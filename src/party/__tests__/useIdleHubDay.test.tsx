import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useIdleHubDay } from '@/party/useIdleHubDay';
import type { TallySession } from '@/stores/tallyStore';

const finished: TallySession = {
  clientId: 'night',
  pubKey: 'u2fkbnyx',
  pubName: 'U Kotvy',
  startedAt: new Date(2026, 8, 11, 22).toISOString(),
  drinks: [
    { id: 'beer', beerName: 'Plzeň', at: new Date(2026, 8, 11, 22).toISOString() },
  ] as TallySession['drinks'],
};
const history = [finished];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 12, 3, 59, 30));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('moves the finished night from the count into Naposledy across 04:00 without a data change', () => {
  const { result, unmount } = renderHook(() => useIdleHubDay(null, history));
  expect(result.current).toEqual({ beerCount: 1, lastSession: null });

  act(() => jest.advanceTimersByTime(60_000));

  expect(result.current).toEqual({ beerCount: 0, lastSession: finished });
  unmount();
});

it('updates both values immediately when the app returns after the cutoff', () => {
  let onAppState!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    onAppState = listener;
    return { remove: jest.fn() };
  });
  const { result, unmount } = renderHook(() => useIdleHubDay(null, history));
  expect(result.current).toEqual({ beerCount: 1, lastSession: null });

  act(() => {
    onAppState?.('background');
    jest.setSystemTime(new Date(2026, 8, 12, 8));
    onAppState?.('active');
  });

  expect(result.current).toEqual({ beerCount: 0, lastSession: finished });
  unmount();
});
