import React from 'react';
import { FlatList } from 'react-native';

import type { PublishedNight } from '@/data/nightsClient';

import FeedScreen from '../FeedScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEnsureAccount = jest.fn();
const mockFetchNightsFeed = jest.fn();
const mockLoadNightFeedCache = jest.fn();
const mockSaveNightFeedCache = jest.fn();
let mockAccountState: { session: null | { accountId: string } } = {
  session: { accountId: 'account-a' },
};

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/shared/GlassIconButton', () => ({ GlassIconButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => {
  const Icon = () => null;
  return {
    DicesIcon: Icon,
    MapPinIcon: Icon,
    MenuIcon: Icon,
    MessageSquareIcon: Icon,
    SearchIcon: Icon,
  };
});
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/components/shared/UnderlineTabs', () => ({ UnderlineTabs: () => null }));
jest.mock('@/data/account', () => ({
  ensureAccount: (...args: unknown[]) => mockEnsureAccount(...args),
}));
jest.mock('@/data/nightsClient', () => ({
  clearNightReaction: jest.fn(),
  fetchNightsFeed: (...args: unknown[]) => mockFetchNightsFeed(...args),
  isRetriableNightError: jest.fn(() => false),
  reactToNight: jest.fn(),
}));
jest.mock('@/data/nightsQueue', () => ({ enqueueNightOp: jest.fn() }));
jest.mock('@/feed/CheersButton', () => ({ CheersButton: () => null }));
jest.mock('@/feed/feedCache', () => ({
  loadNightFeedCache: (...args: unknown[]) => mockLoadNightFeedCache(...args),
  saveNightFeedCache: (...args: unknown[]) => mockSaveNightFeedCache(...args),
}));
jest.mock('@/feed/useNightActions', () => ({ useNightActions: () => jest.fn() }));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/mocks/mockTheme', () => ({ MockLayout: { screenPad: 20 } }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: typeof mockAccountState) => unknown) =>
    selector(mockAccountState),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));
jest.mock('@/theme/fonts', () => ({
  Fonts: { numeral: 'numeral' },
  FontScaleCap: { heading: 1.2, body: 1.3 },
}));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function account(accountId: string) {
  return {
    deviceId: `device-${accountId}`,
    accountId,
    token: `token-${accountId}`,
    authenticated: true,
  };
}

function night(id: string, author: string): PublishedNight {
  return {
    id,
    clientId: `client-${id}`,
    author: {
      id: `author-${id}`,
      nickname: author,
      displayName: author,
      avatarUrl: null,
      isPublic: true,
    },
    drinkingDay: '2026-08-05',
    startedAt: '2026-08-05T19:00:00Z',
    endedAt: '2026-08-05T22:00:00Z',
    beerCount: 4,
    wineCount: 0,
    softDrinkCount: 0,
    shotCount: 0,
    pubNames: [],
    city: '',
    durationMinutes: 180,
    title: `Večer ${author}`,
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    visibility: 'friends',
    createdAt: '2026-08-05T22:05:00Z',
    rounds: 0,
    myRound: false,
    isMine: false,
    commentCount: 0,
  };
}

function feedData(renderer: ReturnType<typeof TestRenderer.create>): PublishedNight[] {
  return renderer.root.findByType(FlatList).props.data as PublishedNight[];
}

async function settleEffects(): Promise<void> {
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('FeedScreen account boundary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAccountState = { session: { accountId: 'account-a' } };
    mockEnsureAccount.mockImplementation(async () =>
      mockAccountState.session ? account(mockAccountState.session.accountId) : null,
    );
    mockLoadNightFeedCache.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('removes account A feed synchronously when account B is offline', async () => {
    const oldNight = night('night-a', 'stary_ucet');
    mockFetchNightsFeed.mockResolvedValueOnce({
      ok: true,
      nights: [oldNight],
      nextCursor: null,
    });

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FeedScreen />);
    });
    await act(settleEffects);
    expect(feedData(renderer!)).toEqual([oldNight]);

    mockAccountState = { session: { accountId: 'account-b' } };
    mockFetchNightsFeed.mockResolvedValueOnce({
      ok: false,
      code: 'network',
      detail: 'Bez signálu.',
    });

    act(() => {
      renderer!.update(<FeedScreen />);
    });

    // The previous friends-only feed is gone before B's request starts.
    expect(feedData(renderer!)).toEqual([]);

    await act(settleEffects);
    expect(feedData(renderer!)).toEqual([]);
    expect(mockEnsureAccount).toHaveBeenCalledTimes(2);
    expect(mockFetchNightsFeed).toHaveBeenCalledTimes(2);
  });

  it('keeps the same account cached feed when its refresh is offline', async () => {
    const cachedNight = night('cached-a', 'offline_cache');
    mockLoadNightFeedCache.mockResolvedValueOnce({
      nights: [cachedNight],
      nextCursor: null,
      savedAt: Date.now(),
    });
    mockFetchNightsFeed.mockResolvedValueOnce({
      ok: false,
      code: 'network',
      detail: 'Bez signálu.',
    });

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FeedScreen />);
    });
    await act(settleEffects);

    expect(feedData(renderer!)).toEqual([cachedNight]);
  });
});
