import React from 'react';

import type { FriendProfileDetail } from '@/data/friendsClient';
import type { PublishedNight } from '@/data/nightsClient';

import PublicProfileScreen from '../PublicProfileScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockShowDialog = jest.fn();
const mockShowToast = jest.fn();
const mockFetchFriendProfile = jest.fn();
const mockFetchProfileNights = jest.fn();
const mockReportProfileContent = jest.fn();
const mockBlockFriend = jest.fn();
const mockUnblockFriend = jest.fn();
const mockNotifyNightFeedSafetyChange = jest.fn();
let mockAccountState: { session: { accountId: string } | null } = {
  session: { accountId: 'viewer-1' },
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ accountId: 'friend-1' }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({
  showAppDialog: (...args: unknown[]) => mockShowDialog(...args),
}));
jest.mock('@/components/shared/IconGlyph', () => {
  const Icon = () => null;
  return {
    BeerIcon: Icon,
    CheckIcon: Icon,
    ChevronLeftIcon: Icon,
    MenuIcon: Icon,
    PlusIcon: Icon,
  };
});
jest.mock('@/components/shared/UnderlineTabs', () => ({
  UnderlineTabs: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react');
    return ReactModule.createElement('UnderlineTabs', props);
  },
}));
jest.mock('@/data/achievements', () => ({ EMPTY_ACHIEVEMENTS: {} }));
jest.mock('@/data/auth', () => ({
  reportProfileContent: (...args: unknown[]) => mockReportProfileContent(...args),
}));
jest.mock('@/data/friendsClient', () => ({
  blockFriend: (...args: unknown[]) => mockBlockFriend(...args),
  cancelFriendRequest: jest.fn(),
  fetchFriendProfile: (...args: unknown[]) => mockFetchFriendProfile(...args),
  removeFriend: jest.fn(),
  respondFriendRequest: jest.fn(),
  sendFriendRequest: jest.fn(),
  unblockFriend: (...args: unknown[]) => mockUnblockFriend(...args),
}));
jest.mock('@/data/nightsClient', () => ({
  fetchProfileNights: (...args: unknown[]) => mockFetchProfileNights(...args),
}));
jest.mock('@/feed/FeedScreen', () => ({
  FeedCard: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react');
    return ReactModule.createElement('FeedCard', props);
  },
}));
jest.mock('@/feed/feedModel', () => ({
  mergeNightPages: (first: unknown[]) => first,
  replaceNightReaction: (nights: unknown[]) => nights,
}));
jest.mock('@/feed/feedSafetySignal', () => ({
  notifyNightFeedSafetyChange: (...args: unknown[]) =>
    mockNotifyNightFeedSafetyChange(...args),
}));
jest.mock('@/feed/useNightActions', () => ({ useNightActions: () => jest.fn() }));
jest.mock('@/feed/useNightReaction', () => ({
  useNightReaction: () => ({ reactingIds: new Set(), toggleReaction: jest.fn() }),
}));
jest.mock('@/friends/ComposeSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/mocks/BarChart', () => ({ BarChart: () => null }));
jest.mock('@/mocks/SectionBreak', () => ({ SectionBreak: () => null }));
jest.mock('@/mocks/Segmented', () => ({ Segmented: () => null }));
jest.mock('@/mocks/StatGrid', () => ({ StatGrid: () => null }));
jest.mock('@/mocks/mockTheme', () => ({
  MockLayout: { screenPad: 20 },
  MockType: { titleXL: {} },
}));
jest.mock('@/profile/AchievementGrid', () => ({ AchievementGrid: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/profile/profileStats', () => ({
  profileTimelineSeries: () => ({ points: [], totals: [] }),
}));
jest.mock('@/stores/accountStore', () => {
  const useAccountStore = Object.assign(
    (selector: (state: typeof mockAccountState) => unknown) => selector(mockAccountState),
    { getState: () => mockAccountState },
  );
  return { useAccountStore };
});
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const detail: FriendProfileDetail = {
  profile: {
    id: 'friend-1',
    nickname: 'honza',
    displayName: 'Honza',
    avatarUrl: null,
    isPublic: true,
  },
  isFriend: true,
  friendshipId: 'friendship-1',
  stats: {
    sharedPubCount: 2,
    nightsTogether: 2,
    lastSharedAt: null,
    lastPubName: '',
    streakWeeks: 0,
    rituals: [],
  },
  liveActivity: null,
  plan: null,
  recentTogether: [],
  latestBeers: [],
  blocked: false,
  friendshipStatus: 'accepted',
  incomingRequestId: null,
  publicStats: null,
  achievements: null,
  publishedTimeline: null,
  isFollowing: false,
};

const privateNight: PublishedNight = {
  id: 'night-a',
  author: detail.profile,
  drinkingDay: '2026-08-06',
  startedAt: '2026-08-06T18:00:00Z',
  endedAt: '2026-08-06T22:00:00Z',
  beerCount: 4,
  wineCount: 0,
  softDrinkCount: 0,
  shotCount: 0,
  pubNames: ['Tajná hospoda'],
  city: 'Brno',
  durationMinutes: 240,
  title: 'A-čkův večer',
  roastLine: '',
  roastBasis: '',
  participants: [],
  heroPhotos: [],
  heroGames: [],
  visibility: 'friends',
  createdAt: '2026-08-06T22:01:00Z',
  rounds: 0,
  myRound: false,
  isMine: false,
  commentCount: 0,
};

async function renderScreen() {
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<PublicProfileScreen />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
  return renderer!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountState = { session: { accountId: 'viewer-1' } };
  mockFetchFriendProfile.mockResolvedValue(detail);
  mockFetchProfileNights.mockResolvedValue({ ok: true, nights: [], nextCursor: null });
  mockReportProfileContent.mockResolvedValue({ ok: true });
  mockBlockFriend.mockResolvedValue({ ok: true });
  mockUnblockFriend.mockResolvedValue({ ok: true });
  mockNotifyNightFeedSafetyChange.mockResolvedValue(undefined);
});

it('hides A profile and nights synchronously when B is offline', async () => {
  mockFetchFriendProfile
    .mockResolvedValueOnce(detail)
    .mockResolvedValueOnce(null);
  mockFetchProfileNights
    .mockResolvedValueOnce({ ok: true, nights: [privateNight], nextCursor: null })
    .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Bez signálu.' });
  const renderer = await renderScreen();

  act(() => {
    renderer.root.findByType('UnderlineTabs').props.onChange('Aktivita');
  });
  expect(renderer.root.findByType('FeedCard').props.night).toBe(privateNight);

  const profileSignal = mockFetchFriendProfile.mock.calls[0][1] as AbortSignal;
  const nightsSignal = mockFetchProfileNights.mock.calls[0][2] as AbortSignal;
  mockAccountState = { session: { accountId: 'viewer-2' } };
  act(() => renderer.update(<PublicProfileScreen />));

  expect(renderer.root.findAllByType('FeedCard')).toHaveLength(0);
  expect(renderer.root.findAllByProps({ accessibilityLabel: 'Další možnosti profilu' }))
    .toHaveLength(0);
  expect(profileSignal.aborted).toBe(true);
  expect(nightsSignal.aborted).toBe(true);

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
  expect(renderer.root.findAllByType('FeedCard')).toHaveLength(0);
});

it('reports a public profile through the confirmed safety menu', async () => {
  const renderer = await renderScreen();

  act(() => {
    renderer.root.findByProps({ accessibilityLabel: 'Další možnosti profilu' }).props.onPress();
  });
  const menu = mockShowDialog.mock.calls[0][0] as {
    buttons: { text: string; onPress?: () => void }[];
  };
  expect(menu.buttons.map((button) => button.text)).toEqual([
    'Nahlásit',
    'Zablokovat',
    'Zrušit',
  ]);
  act(() => menu.buttons[0].onPress?.());
  const confirmation = mockShowDialog.mock.calls[1][0] as {
    buttons: { onPress?: () => void }[];
  };
  await act(async () => {
    confirmation.buttons[1].onPress?.();
    await Promise.resolve();
  });

  expect(mockReportProfileContent).toHaveBeenCalledWith({
    targetAccountId: 'friend-1',
    reason: 'other',
    comment: '@honza',
  });
  expect(mockShowToast).toHaveBeenCalledWith('Díky, mrknu na to.');
});

it('blocks behind confirmation and keeps an explicit unblock path', async () => {
  const renderer = await renderScreen();

  act(() => {
    renderer.root.findByProps({ accessibilityLabel: 'Další možnosti profilu' }).props.onPress();
  });
  const menu = mockShowDialog.mock.calls[0][0] as {
    buttons: { onPress?: () => void }[];
  };
  act(() => menu.buttons[1].onPress?.());
  const confirmation = mockShowDialog.mock.calls[1][0] as {
    buttons: { onPress?: () => void }[];
  };
  await act(async () => {
    confirmation.buttons[1].onPress?.();
    await Promise.resolve();
  });

  expect(mockBlockFriend).toHaveBeenCalledWith('friend-1');
  expect(mockNotifyNightFeedSafetyChange).toHaveBeenCalledWith({
    viewerAccountId: 'viewer-1',
    targetAccountId: 'friend-1',
    blocked: true,
  });
  expect(renderer.root.findByProps({ children: 'Profil je zablokovaný.' })).toBeTruthy();
  const unblock = renderer.root.findByProps({ accessibilityLabel: 'Odblokovat' });
  await act(async () => {
    unblock.props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockUnblockFriend).toHaveBeenCalledWith('friend-1');
  expect(mockNotifyNightFeedSafetyChange).toHaveBeenLastCalledWith({
    viewerAccountId: 'viewer-1',
    targetAccountId: 'friend-1',
    blocked: false,
  });
  expect(mockFetchFriendProfile).toHaveBeenCalledTimes(2);
  expect(mockShowToast).toHaveBeenCalledWith('Odblokováno.');
});
