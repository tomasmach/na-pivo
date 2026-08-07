import React from 'react';

import ChallengeRoute from '../(tabs)/community/challenge/[id]';
import EventRoute from '../(tabs)/community/event/[id]';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFetchCommunityEvent = jest.fn();
const mockFetchChallenge = jest.fn();
let mockAccountState: { session: { accountId: string } | null } = {
  session: { accountId: 'account-a' },
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'detail-1' }),
}));
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));
jest.mock('@/community/EventDetailScreen', () => ({
  EventDetailScreen: ({ event }: { event: unknown }) =>
    React.createElement('EventDetailScreen', { event }),
}));
jest.mock('@/community/ChallengeDetailScreen', () => ({
  ChallengeDetailScreen: ({ challenge }: { challenge: unknown }) =>
    React.createElement('ChallengeDetailScreen', { challenge }),
}));
jest.mock('@/data/communityEventsClient', () => ({
  fetchCommunityEvent: (...args: unknown[]) => mockFetchCommunityEvent(...args),
}));
jest.mock('@/data/challengesClient', () => ({
  fetchChallenge: (...args: unknown[]) => mockFetchChallenge(...args),
}));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/stores/accountStore', () => {
  const useAccountStore = Object.assign(
    (selector: (state: typeof mockAccountState) => unknown) => selector(mockAccountState),
    { getState: () => mockAccountState },
  );
  return { useAccountStore };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const privateEvent = {
  id: 'detail-1',
  title: 'A-čkův večer',
  exactAddress: 'Tajná 12',
  joinRequests: [{ id: 'request-a' }],
};
const privateChallenge = {
  id: 'detail-1',
  title: 'A-čkova výzva',
  done: 9,
  friends: [{ account: { id: 'friend-a' }, done: 8 }],
};

async function settle(): Promise<void> {
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  await Promise.resolve();
}

describe('community detail account boundary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAccountState = { session: { accountId: 'account-a' } };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hides A event detail synchronously when B is offline', async () => {
    mockFetchCommunityEvent
      .mockResolvedValueOnce({ ok: true, event: privateEvent })
      .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Bez signálu.' });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<EventRoute />);
    });
    await act(settle);
    expect(renderer!.root.findByType('EventDetailScreen').props.event).toBe(privateEvent);

    const firstSignal = mockFetchCommunityEvent.mock.calls[0][1] as AbortSignal;
    mockAccountState = { session: { accountId: 'account-b' } };
    act(() => renderer!.update(<EventRoute />));

    expect(renderer!.root.findAllByType('EventDetailScreen')).toHaveLength(0);
    expect(firstSignal.aborted).toBe(true);
    await act(settle);
    expect(renderer!.root.findAllByType('EventDetailScreen')).toHaveLength(0);
  });

  it('hides A challenge progress synchronously when B is offline', async () => {
    mockFetchChallenge
      .mockResolvedValueOnce(privateChallenge)
      .mockResolvedValueOnce(null);
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<ChallengeRoute />);
    });
    await act(settle);
    expect(renderer!.root.findByType('ChallengeDetailScreen').props.challenge).toBe(
      privateChallenge,
    );

    const firstSignal = mockFetchChallenge.mock.calls[0][1] as AbortSignal;
    mockAccountState = { session: { accountId: 'account-b' } };
    act(() => renderer!.update(<ChallengeRoute />));

    expect(renderer!.root.findAllByType('ChallengeDetailScreen')).toHaveLength(0);
    expect(firstSignal.aborted).toBe(true);
    await act(settle);
    expect(renderer!.root.findAllByType('ChallengeDetailScreen')).toHaveLength(0);
  });
});
