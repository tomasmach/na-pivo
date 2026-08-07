import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchLeaderboard = jest.fn();
const fetchChallenges: jest.Mock = jest.fn(async () => []);
const fetchCommunityEvents = jest.fn(async () => ({
  ok: false,
  code: 'auth',
  detail: 'Nejdřív se přihlas.',
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/compass/permissions', () => ({
  checkLocationPermission: async () => 'denied',
}));
jest.mock('@/data/leaderboardsClient', () => ({
  fetchLeaderboard: (...args: unknown[]) => (fetchLeaderboard as jest.Mock)(...args),
}));
jest.mock('@/data/challengesClient', () => ({
  fetchChallenges: (...args: unknown[]) => (fetchChallenges as jest.Mock)(...args),
}));
jest.mock('@/data/communityEventsClient', () => ({
  fetchCommunityEvents: (...args: unknown[]) => (fetchCommunityEvents as jest.Mock)(...args),
}));
jest.mock('@/mocks/MenuChip', () => ({
  MenuChip: (props: Record<string, unknown>) => React.createElement('MenuChip', props),
}));
jest.mock('@/components/shared/UnderlineTabs', () => ({
  UnderlineTabs: (props: Record<string, unknown>) => React.createElement('UnderlineTabs', props),
}));
jest.mock('@/community/EventCover', () => ({
  EventCover: () => null,
  eventDateLabel: () => 'so 8. 8.',
  eventTimeLabel: () => 'od 18:00',
  eventPlaceLabel: () => 'Praha',
}));
jest.mock('@/community/ChallengeGlyphIcon', () => ({ ChallengeGlyphIcon: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronRightIcon: () => null }));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@/theme/fonts', () => ({ FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 } }));

import CommunityMockScreen from '../CommunityMockScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const BOARD = {
  category: 'beers',
  period: 'week',
  periodStart: null,
  totalRanked: 0,
  entries: [],
  me: { rank: null, score: 0, listed: false, eligible: true },
};

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CommunityMockScreen leaderboard controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchLeaderboard.mockResolvedValue(BOARD);
    fetchChallenges.mockResolvedValue([]);
  });

  it('changes the backend query for metric and period, with Mapér fixed to all-time', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<CommunityMockScreen />);
      await flush();
    });

    expect(fetchLeaderboard).toHaveBeenCalledWith('beers', 'week', expect.any(Object));
    const chips = renderer!.root.findAllByType('MenuChip');
    const metric = chips.find((chip: { props: { title?: string } }) => chip.props.title === 'Podle čeho');
    const period = chips.find((chip: { props: { title?: string } }) => chip.props.title === 'Za jaké období');

    await act(async () => {
      metric!.props.onChange('Hospody');
      await flush();
    });
    expect(fetchLeaderboard).toHaveBeenLastCalledWith('pubs', 'week', expect.any(Object));

    await act(async () => {
      period!.props.onChange('Letos');
      await flush();
    });
    expect(fetchLeaderboard).toHaveBeenLastCalledWith('pubs', 'year', expect.any(Object));

    await act(async () => {
      metric!.props.onChange('Mapér XP');
      await flush();
    });
    expect(fetchLeaderboard).toHaveBeenLastCalledWith('mapper', 'all', expect.any(Object));
  });

  it('replaces failed challenge skeletons with a retry action', async () => {
    fetchChallenges.mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<CommunityMockScreen />);
      await flush();
    });

    const tabs = renderer!.root.findByType('UnderlineTabs');
    await act(async () => {
      tabs.props.onChange('Výzvy');
      await flush();
    });
    const retry = renderer!.root.findByProps({
      accessibilityLabel: 'Zkusit načíst výzvy znovu',
    });

    await act(async () => {
      retry.props.onPress();
      await flush();
    });
    expect(fetchChallenges).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true }),
    );
  });
});
