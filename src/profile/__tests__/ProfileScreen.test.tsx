/**
 * The Profile tab stays mounted for the whole process, so its photo strip has
 * to follow the account behind the session, not only the first mount.
 */

import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

let mockFocused = false;
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: jest.fn(() => ({ push: jest.fn(), navigate: jest.fn() })),
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]);
    },
  };
});
jest.mock('@/data/leaderboardsClient', () => ({ fetchLeaderboard: jest.fn(async () => null) }));

// The photos wait for the first focus, which the mocked useFocusEffect fires only when asked.
jest.mock('@/navigation/TabScreen', () => ({
  ...jest.requireActual('@/navigation/TabScreen'),
  useFirstFocus: () => true,
}));

jest.mock('@/components/shared/IconGlyph', () => {
  const Icon = () => null;
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : Icon) });
});

jest.mock('@/stats/useMyStats', () => ({ useMyStats: () => null }));
jest.mock('@/profile/useAccountBadges', () => ({
  useAccountBadges: () => null,
  useRefreshBadgesOnFocus: () => undefined,
}));

const mockFetchMyBeerPhotos = jest.fn();
jest.mock('@/data/beerPhotosClient', () => ({
  ...jest.requireActual('@/data/beerPhotosClient'),
  fetchMyBeerPhotos: (...args: unknown[]) => mockFetchMyBeerPhotos(...args),
}));

import { t } from '@/i18n';
import type { BeerPhoto } from '@/data/beerPhotosClient';
import type { AccountSession } from '@/data/account';
import ProfileScreen from '@/profile/ProfileScreen';
import { useAccountStore } from '@/stores/accountStore';
import {
  clearFriendsDashboardSnapshot,
  saveFriendsDashboardSnapshot,
  snapshotGeneration,
} from '@/data/friendsSnapshot';
import type { FriendsDashboard } from '@/data/friendsClient';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function session(accountId: string, authenticated: boolean): AccountSession {
  return { deviceId: `device-${accountId}`, accountId, token: `token-${accountId}`, authenticated };
}

function photo(clientId: string, caption: string): BeerPhoto {
  return {
    id: `srv-${clientId}`,
    clientId,
    imageUrl: `https://api.test/media/${clientId}.jpg`,
    caption,
    pubCacheKey: '',
    pubName: '',
    pubCity: '',
    visibility: 'private',
    takenAt: '2026-07-01T19:00:00.000Z',
    createdAt: '2026-07-01T19:00:05.000Z',
    inContest: false,
  };
}

const photosByAccount: Record<string, BeerPhoto[]> = {
  'account-a': [photo('a-1', 'Ačko u Pinkasů')],
  'anonymous-1': [],
  'account-b': [photo('b-1', 'Béčko na Letné')],
};

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
  });
}

async function switchSession(next: AccountSession) {
  await act(async () => {
    useAccountStore.setState({ session: next });
  });
  await settle();
}

function shownCaptions(root: { findAll: (match: (node: any) => boolean) => any[] }): string[] {
  const labels = Object.values(photosByAccount)
    .flat()
    .map((item) => item.caption);
  return labels.filter(
    (caption) =>
      root.findAll((node) => node.props?.accessibilityLabel === t.a11y.photoTile(caption)).length > 0,
  );
}

describe('ProfileScreen beer photos', () => {
  let renderer: { unmount: () => void; update: (element: React.ReactElement) => void; root: any } | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFocused = false;
    mockFetchMyBeerPhotos.mockImplementation(async () => {
      const accountId = useAccountStore.getState().session?.accountId ?? '';
      return photosByAccount[accountId] ?? [];
    });
    useBeerPhotosStore.setState({ photos: [] });
    useAccountStore.setState({ session: session('account-a', true), profile: null });
  });

  afterEach(() => {
    if (!renderer) return;
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  async function renderProfile() {
    await act(async () => {
      renderer = TestRenderer.create(<ProfileScreen />);
    });
    await settle();
    return renderer!.root;
  }

  async function logOut() {
    // What the logout wipe does to the store before the session moves.
    await act(async () => {
      useBeerPhotosStore.setState({ photos: [] });
    });
    await switchSession(session('anonymous-1', false));
  }

  it('loads the photos again when the same account signs back in', async () => {
    const root = await renderProfile();
    expect(shownCaptions(root)).toEqual(['Ačko u Pinkasů']);

    await logOut();
    expect(shownCaptions(root)).toEqual([]);

    await switchSession(session('account-a', true));
    expect(shownCaptions(root)).toEqual(['Ačko u Pinkasů']);
  });

  it('shows only the new account photos after signing in as someone else', async () => {
    const root = await renderProfile();

    await logOut();
    await switchSession(session('account-b', true));

    expect(shownCaptions(root)).toEqual(['Béčko na Letné']);
  });

  it('forgets the previous account Parta count after logout', async () => {
    const friends = [{ id: 'f-1' }, { id: 'f-2' }, { id: 'f-3' }];
    await saveFriendsDashboardSnapshot({ friends } as unknown as FriendsDashboard, snapshotGeneration());
    mockFocused = true;
    const root = await renderProfile();
    const partaValue = () =>
      root.find((node: any) => node.props?.title === t.profile.partaRow).props.value;
    expect(partaValue()).toBe('3');

    // Logout runs on /account above the tabs, so Profile is refocused afterwards.
    mockFocused = false;
    await act(async () => renderer!.update(<ProfileScreen />));
    await clearFriendsDashboardSnapshot();
    await logOut();
    mockFocused = true;
    await act(async () => renderer!.update(<ProfileScreen />));
    await settle();

    expect(partaValue()).toBeNull();
  });
});
