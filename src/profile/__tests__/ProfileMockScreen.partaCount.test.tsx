import React from 'react';

import { cs } from '@/i18n/cs';

import ProfileMockScreen from '../ProfileMockScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFocus = { last: null as (() => void | (() => void)) | null };

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    // Close to the real hook: the callback runs on mount and whenever its
    // identity changes (which is how an account switch re-triggers it), its
    // cleanup runs on the way out, and the active callback stays stored so a
    // test can simulate returning to the tab.
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => {
        mockFocus.last = callback;
        const cleanup = callback();
        return () => {
          if (typeof cleanup === 'function') cleanup();
        };
      }, [callback]);
    },
  };
});
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const mockLoadFriendsDashboardSnapshot = jest.fn();
jest.mock('@/data/friendsSnapshot', () => ({
  loadFriendsDashboardSnapshot: (...args: unknown[]) =>
    mockLoadFriendsDashboardSnapshot(...args),
}));

jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/data/nightsClient', () => ({
  fetchMyNights: jest.fn(async () => ({ ok: false, detail: '' })),
}));
jest.mock('@/feed/FeedScreen', () => ({
  FeedCard: (props: Record<string, unknown>) => {
    const ReactModule = jest.requireActual('react');
    return ReactModule.createElement('FeedCard', props);
  },
}));
jest.mock('@/feed/feedCache', () => ({
  loadNightFeedCache: jest.fn(async () => null),
  saveNightFeedCache: jest.fn(async () => {}),
}));
jest.mock('@/feed/feedModel', () => ({
  mergeNightPages: (first: unknown[], second: unknown[]) => [...first, ...second],
}));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/mocks/BarChart', () => ({ BarChart: () => null }));
jest.mock('@/mocks/SectionBreak', () => ({ SectionBreak: () => null }));
jest.mock('@/mocks/Segmented', () => ({ Segmented: () => null }));
jest.mock('@/mocks/StatGrid', () => ({ StatGrid: () => null }));
jest.mock('@/photos/PhotoDiarySection', () => ({ PhotoDiarySection: () => null }));
jest.mock('@/profile/AchievementGrid', () => ({ AchievementGrid: () => null }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/components/shared/UnderlineTabs', () => ({ UnderlineTabs: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronRightIcon: () => null,
  HistoryIcon: () => null,
  PencilIcon: () => null,
  UsersIcon: () => null,
}));

interface MockProfile {
  id: string;
  nickname: string;
  displayName: string;
  avatarUrl: string | null;
  mapper: number;
  pivar: number;
  achievements: unknown[];
}

const mockAccount = {
  state: {
    signedIn: true,
    profile: null as MockProfile | null,
  },
};

jest.mock('@/stores/accountStore', () => ({
  selectIsSignedIn: (s: { signedIn: boolean }) => s.signedIn,
  useAccountStore: (selector: (s: typeof mockAccount['state']) => unknown) =>
    selector(mockAccount.state),
}));

jest.mock('@/stats/useMyStats', () => ({
  useMyStatsState: () => ({ stats: null, status: 'loading', retry: jest.fn() }),
}));

const TestRenderer = jest.requireActual('react-test-renderer');

function profile(id: string): MockProfile {
  return {
    id,
    nickname: id,
    displayName: `Účet ${id}`,
    avatarUrl: null,
    mapper: 0,
    pivar: 0,
    achievements: [],
  };
}

function snapshotWith(relationshipFriendsCount: number | undefined, listedFriends: number) {
  return {
    savedAt: Date.now(),
    dashboard: {
      friends: Array.from({ length: listedFriends }, (_, i) => ({
        id: `friend-${i}`,
        nickname: null,
        displayName: `Kamarád ${i}`,
        avatarUrl: null,
        isPublic: true,
      })),
      ...(relationshipFriendsCount === undefined
        ? {}
        : {
            relationshipPage: {
              friendsCount: relationshipFriendsCount,
              followingCount: 0,
              nextCursor: null,
              followingNextCursor: null,
              friendsTruncated: false,
              followingTruncated: false,
            },
          }),
    },
  };
}

async function settle(): Promise<void> {
  await TestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderScreen(): ReturnType<typeof TestRenderer.create> {
  let renderer: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(Wrapper, { accountId: 'account-a' }));
  });
  mountedRenderers.push(renderer!);
  return renderer!;
}

/** Live renderers, unmounted after each test so effects never outlive one. */
const mountedRenderers: ReturnType<typeof TestRenderer.create>[] = [];

function Wrapper(_props: { accountId: string }) {
  return React.createElement(ProfileMockScreen);
}

function rerender(
  renderer: ReturnType<typeof TestRenderer.create>,
  accountId: string,
): void {
  TestRenderer.act(() => {
    // Same component type, changed prop: the screen re-renders in place, the
    // way mounted tabs observe a credential replacement mid-session.
    renderer.update(React.createElement(Wrapper, { accountId }));
  });
}

/** Texts inside the Parta door: the label plus the optional count line. */
function partaDoorTexts(
  renderer: ReturnType<typeof TestRenderer.create>,
): string[] {
  const door = renderer.root.findByProps({ accessibilityLabel: cs.a11y.profileParta });
  return door.findAllByType('Text').map((node: { props: { children?: unknown } }) => String(node.props.children));
}

describe('ProfileMockScreen Parta count', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Drop leftover mockResolvedValueOnce values queued by an earlier test.
    mockLoadFriendsDashboardSnapshot.mockReset();
    mockFocus.last = null;
    mockAccount.state.signedIn = true;
    mockAccount.state.profile = profile('account-a');
  });

  afterEach(async () => {
    await TestRenderer.act(async () => {
      while (mountedRenderers.length) mountedRenderers.pop()?.unmount();
    });
  });

  it('shows the full relationshipPage count, not the first page length', async () => {
    // 250 friends overall, only the first page of 100 persisted in the list.
    mockLoadFriendsDashboardSnapshot.mockResolvedValueOnce(snapshotWith(250, 100));

    const renderer = renderScreen();
    await settle();

    expect(partaDoorTexts(renderer)).toContain(cs.profile.partaCount(250));
  });

  // The raw snapshot storage is a single global blob, not keyed by owner:
  // whoever reads next gets the previous account's data back. After an
  // A -> B credential replacement the mounted tab must therefore neither
  // re-read (it would only get A's blob) nor paint A's count under B.
  it('does not leak account A\'s raw snapshot into account B after a switch', async () => {
    const rawA = snapshotWith(250, 100);
    mockLoadFriendsDashboardSnapshot.mockImplementation(async () => rawA);

    const renderer = renderScreen();
    await settle();
    expect(mockLoadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(partaDoorTexts(renderer)).toContain(cs.profile.partaCount(250));

    // Credential replaced mid-session while the tab stays mounted.
    mockAccount.state.profile = profile('account-b');
    rerender(renderer, 'account-b');
    await settle();

    // A further read would hand back A's snapshot again, so the loader must
    // stay untouched and B starts with no count at all — never A's 250.
    expect(partaDoorTexts(renderer)).toEqual([cs.profile.moreParta]);
    expect(mockLoadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);
  });

  // Once a different non-null owner shows up in-process, the raw-snapshot read
  // locks permanently: even re-focusing the tab under B must not go back to
  // the shared blob — it would only ever hand back A's data.
  it('stays locked after the switch: a refocus under B never reads the raw cache', async () => {
    const rawA = snapshotWith(250, 100);
    mockLoadFriendsDashboardSnapshot.mockImplementation(async () => rawA);

    const renderer = renderScreen();
    await settle();
    expect(mockLoadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);

    mockAccount.state.profile = profile('account-b');
    rerender(renderer, 'account-b');
    await settle();
    expect(partaDoorTexts(renderer)).toEqual([cs.profile.moreParta]);

    mockLoadFriendsDashboardSnapshot.mockResolvedValueOnce(snapshotWith(7, 7));
    await TestRenderer.act(async () => {
      mockFocus.last?.();
    });
    await settle();

    expect(mockLoadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(partaDoorTexts(renderer)).toEqual([cs.profile.moreParta]);
  });

  it('paints nothing when account A\'s snapshot settles after the switch to B', async () => {
    let resolveA!: (value: unknown) => void;
    const lateA = new Promise<unknown>((resolve) => {
      resolveA = resolve;
    });
    mockLoadFriendsDashboardSnapshot.mockReturnValueOnce(lateA);

    const renderer = renderScreen();
    await settle();
    expect(mockLoadFriendsDashboardSnapshot).toHaveBeenCalledTimes(1);
    expect(partaDoorTexts(renderer)).toEqual([cs.profile.moreParta]);

    mockAccount.state.profile = profile('account-b');
    rerender(renderer, 'account-b');
    await settle();

    // A's slow storage read lands while B owns the screen — it belongs to a
    // previous identity, so it must stay invisible.
    resolveA(snapshotWith(250, 100));
    await settle();
    expect(partaDoorTexts(renderer)).toEqual([cs.profile.moreParta]);
  });

  it('refreshes the count from a changed snapshot on focus', async () => {
    mockLoadFriendsDashboardSnapshot.mockResolvedValueOnce(snapshotWith(2, 2));

    const renderer = renderScreen();
    await settle();
    expect(partaDoorTexts(renderer)).toContain(cs.profile.partaCount(2));

    // A friend was accepted elsewhere; the stored snapshot moved on.
    mockLoadFriendsDashboardSnapshot.mockResolvedValueOnce(snapshotWith(3, 3));
    await TestRenderer.act(async () => {
      mockFocus.last?.();
    });
    await settle();

    expect(mockLoadFriendsDashboardSnapshot).toHaveBeenCalledTimes(2);
    expect(partaDoorTexts(renderer)).toContain(cs.profile.partaCount(3));
  });

  it('reads nothing and shows no count while signed out', async () => {
    mockLoadFriendsDashboardSnapshot.mockResolvedValueOnce(snapshotWith(250, 100));
    mockAccount.state.signedIn = false;
    mockAccount.state.profile = null;

    const renderer = renderScreen();
    await settle();

    // No owner, no read — a shared device must not touch the previous
    // account's social snapshot just to paint the profile door.
    expect(mockLoadFriendsDashboardSnapshot).not.toHaveBeenCalled();
    expect(partaDoorTexts(renderer)).toEqual([cs.profile.moreParta]);
  });

  it('keeps the last count when a same-account focus reads a null snapshot', async () => {
    mockLoadFriendsDashboardSnapshot.mockResolvedValueOnce(snapshotWith(4, 4));

    const renderer = renderScreen();
    await settle();
    expect(partaDoorTexts(renderer)).toContain(cs.profile.partaCount(4));

    // Offline re-focus: storage has nothing readable, so the door keeps the
    // count it already shows instead of blanking out.
    mockLoadFriendsDashboardSnapshot.mockResolvedValueOnce(null);
    await TestRenderer.act(async () => {
      mockFocus.last?.();
    });
    await settle();

    expect(mockLoadFriendsDashboardSnapshot).toHaveBeenCalledTimes(2);
    expect(partaDoorTexts(renderer)).toContain(cs.profile.partaCount(4));
  });
});
