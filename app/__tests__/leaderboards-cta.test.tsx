/**
 * The board's call to action leaves for a tab. The tabs are already under this
 * screen, so it must go back to them; a replace would stack a second tab bar.
 */

import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockRouter = { replace: jest.fn(), dismissTo: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
function mockLeaves(defaultName = 'default') {
  const React = jest.requireActual<typeof import('react')>('react');
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === '__esModule'
          ? true
          : (props: { children?: React.ReactNode }) =>
              React.createElement(name === 'default' ? defaultName : String(name), props, props.children),
    },
  );
}
jest.mock('@/components/shared/IconGlyph', () => mockLeaves());
jest.mock('@/components/shared/MoreSheet', () => mockLeaves());
jest.mock('@/components/shared/CardSurface', () => mockLeaves());
jest.mock('@/counter/CounterCta', () => mockLeaves());
jest.mock('@/counter/NudgeSlot', () => mockLeaves());
jest.mock('@/leaderboards/BoardSegmented', () => mockLeaves('BoardSegmented'));
jest.mock('@/leaderboards/BoardSkeleton', () => mockLeaves());
jest.mock('@/leaderboards/GlobalBoardRow', () => mockLeaves());
jest.mock('@/leaderboards/PeriodChips', () => mockLeaves('PeriodChips'));
jest.mock('@/leaderboards/PodiumMats', () => mockLeaves());
jest.mock('@/leaderboards/PubBoardContent', () => mockLeaves());
jest.mock('@/pubPage/openPubPage', () => ({ openPubPage: jest.fn() }));
jest.mock('@/data/telemetryClient', () => ({ trackClientEvent: jest.fn() }));
jest.mock('@/data/leaderboardsClient', () => ({
  fetchLeaderboard: jest.fn(async (category: string, period: string) => ({
    category,
    period,
    periodStart: null,
    totalRanked: 0,
    entries: [],
    me: { rank: null, score: 0, listed: false, eligible: true },
  })),
}));
jest.mock('@/data/pubBoardClient', () => ({
  fetchPubBoard: jest.fn(async (period: string) => ({
    period,
    periodStart: null,
    periodEnd: null,
    city: null,
    cities: [],
    totalRanked: 0,
    entries: [],
  })),
}));

import LeaderboardsScreen from '../leaderboards';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

it.each([
  [0, '/(tabs)/beer'],
  [1, '/(tabs)'],
  [2, '/(tabs)'],
  [3, '/(tabs)/beer'],
])('board %i returns to the existing tabs at %s', async (index, href) => {
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(<LeaderboardsScreen />);
  });
  await act(async () => renderer.root.findByType('BoardSegmented').props.onChange(index));
  await act(async () => renderer.root.findByType('CounterCta').props.onPress());

  expect(mockRouter.dismissTo).toHaveBeenLastCalledWith(href);
  expect(mockRouter.replace).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});
