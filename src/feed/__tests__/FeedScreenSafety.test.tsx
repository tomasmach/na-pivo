import React from 'react';

import type { PublishedNight } from '@/data/nightsClient';
import { notifyNightFeedSafetyChange } from '@/feed/feedSafetySignal';

import FeedScreen from '../FeedScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEnsureAccount = jest.fn();
const mockFetchNightsFeed = jest.fn();
const mockLoadNightFeedCache = jest.fn();
const mockSaveNightFeedCache = jest.fn();
const mockRemoveAccountFromNightFeedCaches = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
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
  isRetriableNightError: jest.fn(),
  reactToNight: jest.fn(),
}));
jest.mock('@/data/nightsQueue', () => ({ enqueueNightOp: jest.fn() }));
jest.mock('@/feed/CheersButton', () => ({ CheersButton: () => null }));
jest.mock('@/feed/feedCache', () => ({
  loadNightFeedCache: (...args: unknown[]) => mockLoadNightFeedCache(...args),
  removeAccountFromNightFeedCaches: (...args: unknown[]) =>
    mockRemoveAccountFromNightFeedCaches(...args),
  saveNightFeedCache: (...args: unknown[]) => mockSaveNightFeedCache(...args),
}));
jest.mock('@/feed/useNightActions', () => ({ useNightActions: () => jest.fn() }));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/mocks/mockTheme', () => ({ MockLayout: { screenPad: 20 } }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (
    selector: (state: { session: { accountId: string } }) => unknown,
  ) => selector({ session: { accountId: 'viewer-1' } }),
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

function night(id: string, authorId: string, nickname: string): PublishedNight {
  return {
    id,
    author: {
      id: authorId,
      nickname,
      displayName: nickname,
      avatarUrl: null,
      isPublic: true,
    },
    drinkingDay: '2026-08-06',
    startedAt: '2026-08-06T18:00:00.000Z',
    endedAt: '2026-08-06T22:00:00.000Z',
    beerCount: 4,
    wineCount: 0,
    softDrinkCount: 0,
    shotCount: 0,
    pubNames: [],
    city: 'Brno',
    durationMinutes: 240,
    title: '',
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    commentCount: 0,
    visibility: 'friends',
    createdAt: '2026-08-06T22:05:00.000Z',
    rounds: 0,
    myRound: false,
    isMine: false,
  };
}

function renderedNights(
  renderer: ReturnType<typeof TestRenderer.create>,
): PublishedNight[] {
  return renderer.root.findByType('FlatList').props.data as PublishedNight[];
}

beforeEach(() => {
  jest.clearAllMocks();
});

async function flushUi(steps = 4): Promise<void> {
  for (let step = 0; step < steps; step += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  }
}

it('removes a blocked author from retained state and cache, then reconciles block changes', async () => {
  const blockedNight = night('night-blocked', 'blocked-author', 'blocked');
  const safeNight = night('night-safe', 'safe-author', 'safe');
  safeNight.participants = [{ ...blockedNight.author }];
  let resolveBlockedRefresh: (
    value: { ok: true; nights: PublishedNight[]; nextCursor: null },
  ) => void = () => undefined;

  mockEnsureAccount.mockResolvedValue({ accountId: 'viewer-1', token: 'test', deviceId: 'test' });
  mockLoadNightFeedCache.mockResolvedValue(null);
  mockSaveNightFeedCache.mockResolvedValue(undefined);
  mockRemoveAccountFromNightFeedCaches.mockResolvedValue(undefined);
  mockFetchNightsFeed
    .mockResolvedValueOnce({ ok: true, nights: [blockedNight, safeNight], nextCursor: null })
    .mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveBlockedRefresh = resolve;
      }),
    )
    .mockResolvedValueOnce({ ok: true, nights: [blockedNight, safeNight], nextCursor: null });

  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(<FeedScreen />);
  });
  await flushUi();
  expect(mockFetchNightsFeed).toHaveBeenCalledTimes(1);
  expect(renderedNights(renderer!).map((item) => item.id)).toEqual([
    'night-blocked',
    'night-safe',
  ]);

  await act(async () => {
    await notifyNightFeedSafetyChange({
      viewerAccountId: 'viewer-1',
      targetAccountId: 'blocked-author',
      blocked: true,
    });
    await Promise.resolve();
  });

  expect(renderedNights(renderer!).map((item) => item.id)).toEqual(['night-safe']);
  expect(renderedNights(renderer!)[0].participants).toEqual([]);
  expect(mockRemoveAccountFromNightFeedCaches).toHaveBeenCalledWith(
    'viewer-1',
    'blocked-author',
  );
  expect(mockFetchNightsFeed).toHaveBeenCalledTimes(2);
  expect(mockSaveNightFeedCache).toHaveBeenCalledWith(
    'viewer-1',
    'friends',
    expect.objectContaining({
      nights: [expect.objectContaining({ id: 'night-safe', participants: [] })],
    }),
  );

  await act(async () => {
    resolveBlockedRefresh({ ok: true, nights: [blockedNight, safeNight], nextCursor: null });
    await Promise.resolve();
  });
  expect(renderedNights(renderer!).map((item) => item.id)).toEqual(['night-safe']);

  await act(async () => {
    await notifyNightFeedSafetyChange({
      viewerAccountId: 'viewer-1',
      targetAccountId: 'blocked-author',
      blocked: false,
    });
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockFetchNightsFeed).toHaveBeenCalledTimes(3);
  expect(renderedNights(renderer!).map((item) => item.id)).toEqual([
    'night-blocked',
    'night-safe',
  ]);
  expect(renderedNights(renderer!)[1].participants).toEqual([blockedNight.author]);
  act(() => renderer!.unmount());
});
