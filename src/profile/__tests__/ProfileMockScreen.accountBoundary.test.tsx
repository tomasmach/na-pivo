import React from 'react';

import type { PublishedNight } from '@/data/nightsClient';
import { cs } from '@/i18n/cs';

import { ProfileActivity, ProfileDiaryDoor } from '../ProfileMockScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFetchMyNights = jest.fn();
const mockLoadNightFeedCache = jest.fn();
const mockSaveNightFeedCache = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/data/nightsClient', () => ({
  fetchMyNights: (...args: unknown[]) => mockFetchMyNights(...args),
}));
jest.mock('@/feed/FeedScreen', () => ({
  FeedCard: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react');
    return ReactModule.createElement('FeedCard', props);
  },
}));
jest.mock('@/feed/feedCache', () => ({
  loadNightFeedCache: (...args: unknown[]) => mockLoadNightFeedCache(...args),
  saveNightFeedCache: (...args: unknown[]) => mockSaveNightFeedCache(...args),
}));
jest.mock('@/feed/feedModel', () => ({
  mergeNightPages: (first: unknown[], second: unknown[]) => [...first, ...second],
}));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/mocks/BarChart', () => ({ BarChart: () => null }));
jest.mock('@/mocks/SectionBreak', () => ({ SectionBreak: () => null }));
jest.mock('@/mocks/Segmented', () => ({ Segmented: () => null }));
jest.mock('@/mocks/StatGrid', () => ({ StatGrid: () => null }));
jest.mock('@/profile/AchievementGrid', () => ({ AchievementGrid: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/components/shared/UnderlineTabs', () => ({ UnderlineTabs: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronRightIcon: () => null,
  HistoryIcon: () => null,
}));
jest.mock('@/stores/accountStore', () => ({
  selectIsSignedIn: () => true,
  useAccountStore: () => null,
}));
jest.mock('@/stats/useMyStats', () => ({
  useMyStatsState: () => ({ stats: null, status: 'loading', retry: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function night(id: string): PublishedNight {
  return {
    id,
    clientId: `client-${id}`,
    author: {
      id: 'account-a',
      nickname: 'stary_ucet',
      displayName: 'Starý účet',
      avatarUrl: null,
      isPublic: true,
    },
    drinkingDay: '2026-08-06',
    startedAt: '2026-08-06T19:00:00Z',
    endedAt: '2026-08-06T22:00:00Z',
    beerCount: 4,
    wineCount: 0,
    softDrinkCount: 0,
    shotCount: 0,
    pubNames: [],
    city: '',
    durationMinutes: 180,
    title: 'Večer starého účtu',
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    visibility: 'friends',
    createdAt: '2026-08-06T22:05:00Z',
    rounds: 0,
    myRound: false,
    isMine: true,
    commentCount: 0,
  };
}

function renderedNights(
  renderer: ReturnType<typeof TestRenderer.create>,
): PublishedNight[] {
  return renderer.root
    .findAllByType('FeedCard')
    .map((node: { props: { night: PublishedNight } }) => node.props.night);
}

async function settleEffects(): Promise<void> {
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProfileActivity account boundary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockLoadNightFeedCache.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('removes account A nights synchronously when account B is offline', async () => {
    const oldNight = night('night-a');
    mockFetchMyNights.mockResolvedValueOnce({
      ok: true,
      nights: [oldNight],
      nextCursor: null,
    });

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <ProfileActivity accountId="account-a" reduceMotion />,
      );
    });
    await act(settleEffects);
    expect(renderedNights(renderer!)).toEqual([oldNight]);

    mockFetchMyNights.mockResolvedValueOnce({
      ok: false,
      code: 'network',
      detail: 'Bez signálu.',
    });

    act(() => {
      renderer!.update(<ProfileActivity accountId="account-b" reduceMotion />);
    });

    expect(renderedNights(renderer!)).toEqual([]);

    await act(settleEffects);
    expect(renderedNights(renderer!)).toEqual([]);
    expect(mockLoadNightFeedCache).toHaveBeenNthCalledWith(1, 'account-a', 'mine');
    expect(mockLoadNightFeedCache).toHaveBeenNthCalledWith(2, 'account-b', 'mine');
  });

  it('keeps a same-account cached activity feed when its refresh is offline', async () => {
    const cachedNight = night('cached-a');
    mockLoadNightFeedCache.mockResolvedValueOnce({
      nights: [cachedNight],
      nextCursor: null,
      savedAt: Date.now(),
    });
    mockFetchMyNights.mockResolvedValueOnce({
      ok: false,
      code: 'network',
      detail: 'Bez signálu.',
    });

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <ProfileActivity accountId="account-a" reduceMotion />,
      );
    });
    await act(settleEffects);

    expect(renderedNights(renderer!)).toEqual([cachedNight]);
  });
});

describe('ProfileDiaryDoor', () => {
  it('exposes the private diary as a normal profile action', () => {
    const onPress = jest.fn();
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<ProfileDiaryDoor onPress={onPress} />);
    });

    const door = renderer!.root.findByProps({ accessibilityLabel: cs.a11y.profileDiary });
    act(() => door.props.onPress());

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
