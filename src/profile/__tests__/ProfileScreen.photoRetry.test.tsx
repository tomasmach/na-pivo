/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from 'react';

import type { BeerPhotoLocal } from '@/stores/beerPhotosStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEnqueueBeerPhoto = jest.fn();
const mockRouter = { navigate: jest.fn(), push: jest.fn() };

const mockFailedPhoto: BeerPhotoLocal = {
  id: null,
  clientId: 'failed-party-photo',
  imageUrl: null,
  localUri: 'file:///docs/beer-photos/failed-party-photo.jpg',
  caption: 'Parta',
  pubCacheKey: 'pub-1',
  pubName: 'U Fleků',
  pubCity: 'Praha',
  partyCode: 'PIVOXY',
  partyDrinkingDay: '2026-08-06',
  visibility: 'friends',
  takenAt: '2026-08-06T22:00:00.000Z',
  createdAt: '2026-08-06T22:00:00.000Z',
  inContest: false,
  syncState: 'failed',
};

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/IconGlyph', () => ({
  ExternalLinkIcon: () => null,
  MenuIcon: () => null,
  SettingsIcon: () => null,
  TrophyIcon: () => null,
  UsersIcon: () => null,
}));
jest.mock('@/components/shared/MoreSheet', () => ({ MoreSheet: () => null }));
jest.mock('@/counter/CounterCta', () => ({
  CounterCta: () => null,
  CounterSecondary: () => null,
}));
jest.mock('@/counter/NudgeSlot', () => ({
  NudgeSlot: (props: Record<string, unknown>) => React.createElement('NudgeSlot', props),
}));
jest.mock('@/data/accountXp', () => ({ accountXpProgress: () => null }));
jest.mock('@/data/beerPhotosQueue', () => ({
  enqueueBeerPhoto: (...args: unknown[]) => mockEnqueueBeerPhoto(...args),
}));
jest.mock('@/data/friendsSnapshot', () => ({
  loadFriendsDashboardSnapshot: jest.fn(async () => null),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/friends/CodeSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/profile/ProfileCard', () => ({ ProfileCard: () => null }));
jest.mock('@/stores/accountStore', () => ({
  selectAvatarUrl: () => null,
  selectIsPublic: () => true,
  selectIsSignedIn: () => true,
  selectNickname: () => 'pivar',
  useAccountStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      session: { accountId: 'account-1', authenticated: true },
      profile: null,
      diarySnapshot: null,
    }),
}));
jest.mock('@/stores/beerPhotosStore', () => ({
  loadBeerPhotos: jest.fn(async () => undefined),
  useBeerPhotosStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ photos: [mockFailedPhoto] }),
    { getState: () => ({ photos: [mockFailedPhoto] }) },
  ),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ priceCurrency: 'CZK' }),
}));
jest.mock('@/stores/tallyStore', () => ({
  allSessionsNewestFirst: () => [],
  sessionCount: () => 0,
  sessionTotalCzk: () => 0,
  useTallyStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ current: null, history: [] }),
}));

import ProfileScreen from '@/profile/ProfileScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

describe('ProfileScreen failed-photo retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnqueueBeerPhoto.mockResolvedValue({
      persisted: false,
      completion: Promise.resolve(),
    });
  });

  it('preserves Party association and opens detail when durable retry staging fails', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<ProfileScreen />);
      await Promise.resolve();
    });

    const nudge = renderer!.root.findByType('NudgeSlot').props.nudge;
    await act(async () => {
      nudge.onUndo();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockEnqueueBeerPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'failed-party-photo',
        partyCode: 'PIVOXY',
        partyDrinkingDay: '2026-08-06',
      }),
    );
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/photo/[key]',
      params: { key: 'failed-party-photo' },
    });
  });
});
