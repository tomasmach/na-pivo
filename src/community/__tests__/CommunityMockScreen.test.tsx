import React from 'react';
import { Text } from 'react-native';

import CommunityMockScreen from '../CommunityMockScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
const mockFetchCommunityEvents = jest.fn();
const mockFetchChallenges = jest.fn();
const mockFetchLeaderboard = jest.fn();
let mockAccountState: {
  profile: null | {
    id: string;
    nickname: string | null;
    displayName: string;
    avatarUrl: string | null;
  };
  session: null | { accountId: string };
} = { profile: null, session: { accountId: 'account-a' } };

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/community/ChallengeGlyphIcon', () => ({ ChallengeGlyphIcon: () => null }));
jest.mock('@/community/EventCover', () => ({ EventCover: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronRightIcon: () => null }));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/components/shared/UnderlineTabs', () => ({
  UnderlineTabs: (props: Record<string, unknown>) => React.createElement('UnderlineTabs', props),
}));
jest.mock('@/data/challengesClient', () => ({
  fetchChallenges: (...args: unknown[]) => mockFetchChallenges(...args),
}));
jest.mock('@/data/communityEventsClient', () => ({
  fetchCommunityEvents: (...args: unknown[]) => mockFetchCommunityEvents(...args),
}));
jest.mock('@/data/leaderboardsClient', () => ({
  fetchLeaderboard: (...args: unknown[]) => mockFetchLeaderboard(...args),
}));
jest.mock('@/friends/SkeletonBlock', () => () => null);
jest.mock('@/mocks/MenuChip', () => ({
  MenuChip: (props: Record<string, unknown>) => React.createElement('MenuChip', props),
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: typeof mockAccountState) => unknown) =>
    selector(mockAccountState),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function renderedText(renderer: ReturnType<typeof TestRenderer.create>): string {
  return renderer.root
    .findAllByType(Text)
    .flatMap((node: { props: { children?: unknown } }) => {
      const children = node.props.children;
      return typeof children === 'string' || typeof children === 'number'
        ? [String(children)]
        : [];
    })
    .join(' ');
}

async function settleEffects(): Promise<void> {
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('CommunityMockScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockReset();
    mockFetchChallenges.mockReset();
    mockFetchChallenges.mockResolvedValue([]);
    mockFetchLeaderboard.mockReset();
    mockFetchLeaderboard.mockResolvedValue(null);
    mockAccountState = { profile: null, session: { accountId: 'account-a' } };
    mockFetchCommunityEvents.mockResolvedValue({
      ok: false,
      code: 'auth',
      detail: 'Pro domácí setkání se nejdřív přihlas.',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers sign-in instead of a false network error when events require an account', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<CommunityMockScreen />);
    });
    await act(async () => {
      await settleEffects();
    });

    act(() => {
      renderer!.root.findByType('UnderlineTabs').props.onChange('Akce');
    });

    const signIn = renderer!.root.findByProps({ accessibilityLabel: 'Přihlásit se pro akce' });
    expect(
      renderer!.root
        .findAllByType(Text)
        .some(
          (node: { props: { children?: unknown } }) =>
            node.props.children === 'Akce se teď nedotáhly. Potáhni dolů a zkus to znovu.',
        ),
    ).toBe(false);
    act(() => signIn.props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/auth');
  });

  it('locks Mapér XP to the truthful all-time board', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<CommunityMockScreen />);
    });
    await act(settleEffects);

    const metricChip = renderer!.root.findAllByType('MenuChip')[0];
    act(() => metricChip.props.onChange('Mapér XP'));
    await act(settleEffects);

    const periodChip = renderer!.root.findAllByType('MenuChip')[1];
    expect(periodChip.props.value).toBe('Celkem');
    expect(periodChip.props.options).toEqual(['Celkem']);
    expect(mockFetchLeaderboard).toHaveBeenLastCalledWith(
      'mapper',
      'all',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('drops prior-account community data synchronously and stays empty offline', async () => {
    mockFetchLeaderboard.mockResolvedValueOnce({
      category: 'beers',
      period: 'week',
      periodStart: null,
      totalRanked: 1,
      entries: [
        {
          rank: 1,
          score: 42,
          isMe: true,
          isFriend: false,
          account: {
            id: 'account-a',
            nickname: 'stary_ucet',
            displayName: 'Starý účet',
            avatarUrl: null,
          },
        },
      ],
      me: { rank: 1, score: 42, listed: true, eligible: true },
    });
    mockFetchChallenges.mockResolvedValueOnce([
      {
        id: 'old-challenge',
        title: 'Soukromý postup A',
        glyph: 'places',
        progress: 0.8,
        done: 8,
        goal: 10,
        unit: 'hospod',
        blurb: '',
        deadline: '2026-08-31',
        reward: '',
        rules: [],
        friends: [],
      },
    ]);
    mockFetchCommunityEvents.mockResolvedValueOnce({
      ok: true,
      dashboard: {
        nearby: [
          {
            id: 'old-event',
            title: 'Moje akce A',
            startsAt: '2026-08-09T18:00:00Z',
            areaLabel: 'Praha',
            city: 'Praha',
          },
        ],
        hosted: [],
        joined: [],
      },
    });

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<CommunityMockScreen />);
    });
    await act(settleEffects);
    expect(renderedText(renderer!)).toContain('@stary_ucet');

    mockAccountState = { profile: null, session: { accountId: 'account-b' } };
    mockFetchLeaderboard.mockResolvedValueOnce(null);
    mockFetchChallenges.mockResolvedValueOnce(null);
    mockFetchCommunityEvents.mockResolvedValueOnce({
      ok: false,
      code: 'network',
      detail: 'Bez signálu.',
    });

    act(() => {
      renderer!.update(<CommunityMockScreen />);
    });

    // The keyed boundary removes A before B's offline requests even start.
    expect(renderedText(renderer!)).not.toContain('@stary_ucet');
    expect(renderedText(renderer!)).not.toContain('Soukromý postup A');
    expect(renderedText(renderer!)).not.toContain('Moje akce A');

    await act(settleEffects);
    expect(renderedText(renderer!)).not.toContain('@stary_ucet');
    expect(renderedText(renderer!)).not.toContain('Soukromý postup A');
    expect(renderedText(renderer!)).not.toContain('Moje akce A');
  });
});
