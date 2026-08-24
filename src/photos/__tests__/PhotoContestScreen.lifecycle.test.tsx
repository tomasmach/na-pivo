import React from 'react';
import { FlatList, Image, Modal, Platform, Pressable } from 'react-native';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PhotoContestScreen from '@/photos/PhotoContestScreen';
import { cs } from '@/i18n/cs';
import { MODAL_DISMISS_MS, useLaunchModalMutex } from '@/stores/launchModalMutex';
import type { PhotoContestSnapshot } from '@/data/photoContestClient';

const mockPush = jest.fn();
const mockFetchPhotoContest = jest.fn();
const mockFetchPhotoContestPage = jest.fn();

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as typeof import('react-native');
  const ReactModule = jest.requireActual('react') as typeof import('react');

  type FlatListMockProps = {
    data: readonly unknown[];
    renderItem: (params: {
      item: unknown;
      index: number;
      separators: {
        highlight: () => undefined;
        unhighlight: () => undefined;
        updateProps: () => undefined;
      };
    }) => React.ReactElement | null;
    ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
    ListFooterComponent?: React.ComponentType | React.ReactElement | null;
    ItemSeparatorComponent?: React.ComponentType | null;
  };

  const renderSlot = (
    slot: React.ComponentType | React.ReactElement | null | undefined,
  ): React.ReactElement | null => {
    if (!slot) return null;
    if (ReactModule.isValidElement(slot)) return slot;
    return ReactModule.createElement(slot);
  };

  const separators = {
    highlight: (): undefined => undefined,
    unhighlight: (): undefined => undefined,
    updateProps: (): undefined => undefined,
  };

  const FlatListMock = (props: FlatListMockProps): React.ReactElement => {
    const children: React.ReactNode[] = [];

    const header = renderSlot(props.ListHeaderComponent);
    if (header) children.push(header);

    props.data.forEach((item, index) => {
      if (index > 0 && props.ItemSeparatorComponent) {
        children.push(
          ReactModule.createElement(props.ItemSeparatorComponent, {
            key: `separator-${index}`,
          }),
        );
      }
      children.push(
        ReactModule.createElement(
          ReactModule.Fragment,
          { key: `row-${index}` },
          props.renderItem({ item, index, separators }),
        ),
      );
    });

    const footer = renderSlot(props.ListFooterComponent);
    if (footer) children.push(footer);

    return ReactModule.createElement(actual.View, null, ...children);
  };

  return { ...actual, RefreshControl: 'RefreshControl', FlatList: FlatListMock };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: jest.fn(),
    replace: jest.fn(),
    push: mockPush,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const RN = jest.requireMock('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(RN.View, props, children),
      Text: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(RN.Text, props, children),
    },
    Easing: {
      cubic: 'cubic',
      quad: 'quad',
      out: (value: unknown) => value,
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: (_delay: number, value: unknown) => value,
    withSequence: (...values: unknown[]) => values.at(-1),
    withTiming: (value: unknown) => value,
  };
});

jest.mock('@/components/shared/AppDialog', () => ({
  AppDialogHost: () => null,
  showAppDialog: jest.fn(),
}));

jest.mock('@/components/shared/GlowButton', () => ({ GlowButton: () => null }));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null,
  CameraIcon: () => null,
  ChevronLeftIcon: () => null,
  MenuIcon: () => null,
  MapPinIcon: () => null,
  TrophyIcon: () => null,
  XIcon: () => null,
}));

jest.mock('@/data/auth', () => ({ reportProfileContent: jest.fn() }));

jest.mock('@/data/photoContestClient', () => ({
  clearPhotoContestVote: jest.fn(),
  enterPhotoContest: jest.fn(),
  fetchPhotoContest: (...args: unknown[]) => mockFetchPhotoContest(...args),
  fetchPhotoContestPage: (...args: unknown[]) => mockFetchPhotoContestPage(...args),
  votePhotoContest: jest.fn(),
  withdrawPhotoContestEntry: jest.fn(),
}));

jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/photos/BeerPhotoCaptureFlow', () => ({ BeerPhotoCaptureFlow: () => null }));

jest.mock('@/photos/ScalePressable', () => ({
  ScalePressable: ({ children, ...props }: React.ComponentProps<typeof Pressable>) => (
    <Pressable {...props}>{children}</Pressable>
  ),
}));

jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));

jest.mock('@/stores/beerPhotosStore', () => ({
  loadBeerPhotos: jest.fn(async () => undefined),
  useBeerPhotosStore: (selector: (state: { photos: never[] }) => unknown) =>
    selector({ photos: [] }),
}));

jest.mock('@/stores/contestResultsStore', () => {
  const state = {
    ingestSnapshot: jest.fn(async () => undefined),
    markResultsSeen: jest.fn(),
  };
  const hook = (selector: (value: typeof state) => unknown) => selector(state);
  hook.getState = () => state;
  return { useContestResultsStore: hook };
});

jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ hapticEnabled: false }) },
}));

jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));

jest.mock('@/utils/haptics', () => ({
  fireLightImpactHaptic: jest.fn(),
  fireSuccessHaptic: jest.fn(),
}));

jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));

const SNAPSHOT: PhotoContestSnapshot = {
  viewerAccountId: 'me',
  contest: {
    id: 'contest-1',
    periodStart: '2026-08-10T00:00:00.000Z',
    periodEnd: '2026-08-24T00:00:00.000Z',
    status: 'open',
  },
  entries: [
    {
      id: 'entry-1',
      photoId: 'photo-1',
      account: {
        id: 'friend-1',
        nickname: 'jarda',
        displayName: 'Jarda',
        avatarUrl: null,
        isPublic: true,
      },
      imageUrl: 'https://cdn.test/photo.jpg',
      caption: 'Pěna drží.',
      pubName: 'U Zlatého tygra',
      pubCity: 'Praha',
      votes: 4,
      myVote: false,
      isMine: false,
      createdAt: '2026-08-21T12:00:00.000Z',
    },
  ],
  myEntry: null,
  entryCount: 1,
  nextCursor: null,
  myEntryId: null,
  myVoteEntryId: null,
  lastResults: null,
};

describe('PhotoContestScreen photo viewer handoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPush.mockClear();
    mockFetchPhotoContest.mockReset();
    mockFetchPhotoContest.mockResolvedValue(SNAPSHOT);
    mockFetchPhotoContestPage.mockReset();
    SNAPSHOT.nextCursor = 'cursor-1';
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) useLaunchModalMutex.getState().release(holder);
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) act(() => useLaunchModalMutex.getState().release(holder));
    jest.useRealTimers();
  });

  it('opens the profile only after native viewer dismissal and the safety delay', async () => {
    const view = render(<PhotoContestScreen />);
    act(() => jest.runOnlyPendingTimers());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const tile = screen.getByLabelText(cs.a11y.contestOpenPhoto('@jarda'));
    act(() =>
      tile.props.onPress({
        nativeEvent: { locationX: 8, locationY: 80 },
      }),
    );

    const modal = view.UNSAFE_getByType(Modal);
    const completeNativeDismiss = modal.props.onDismiss as () => void;
    const profile = modal.findByProps({
      accessibilityLabel: cs.a11y.contestOpenProfile('@jarda'),
    });

    expect(modal.props.visible).toBe(true);
    expect(useLaunchModalMutex.getState().holder).not.toBeNull();

    fireEvent.press(profile);
    expect(mockPush).not.toHaveBeenCalled();

    act(() => completeNativeDismiss());
    act(() => jest.advanceTimersByTime(MODAL_DISMISS_MS - 1));
    expect(mockPush).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/parta/[id]',
      params: { id: 'friend-1' },
    });
    expect(useLaunchModalMutex.getState().holder).toBeNull();
  });

  it('shows a retry action when the fullscreen contest photo cannot load', async () => {
    const view = render(<PhotoContestScreen />);
    act(() => jest.runOnlyPendingTimers());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const tile = screen.getByLabelText(cs.a11y.contestOpenPhoto('@jarda'));
    act(() => tile.props.onPress({ nativeEvent: { locationX: 8, locationY: 80 } }));

    const modal = view.UNSAFE_getByType(Modal);
    const viewerImage = modal.findAllByType(Image).find(
      (image) => image.props.source?.uri === SNAPSHOT.entries[0].imageUrl,
    );
    expect(viewerImage).toBeDefined();
    fireEvent(viewerImage!, 'error');

    expect(screen.getByText(cs.photoDiary.viewerLoadError)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(cs.a11y.photoViewerRetry));
    expect(screen.queryByText(cs.photoDiary.viewerLoadError)).toBeNull();
  });

  it('virtualizes the gallery and coalesces overlapping next-page loads', async () => {
    let resolvePage: (snapshot: PhotoContestSnapshot) => void = () => undefined;
    const deferredPage = new Promise<PhotoContestSnapshot>((resolve) => {
      resolvePage = resolve;
    });
    mockFetchPhotoContestPage.mockReturnValue(deferredPage);

    const view = render(<PhotoContestScreen />);
    act(() => jest.runOnlyPendingTimers());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const list = view.UNSAFE_getByType(FlatList);
    expect(list.props.initialNumToRender).toBe(1);
    expect(list.props.maxToRenderPerBatch).toBe(1);
    expect(list.props.windowSize).toBe(3);
    expect(list.props.removeClippedSubviews).toBe(Platform.OS === 'android');
    expect(typeof list.props.onEndReached).toBe('function');

    act(() => { void list.props.onEndReached(); });
    act(() => { void list.props.onEndReached(); });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockFetchPhotoContestPage).toHaveBeenCalledTimes(1);
    expect(mockFetchPhotoContestPage).toHaveBeenCalledWith('cursor-1');

    const firstEntry = SNAPSHOT.entries[0];
    const freshEntry = {
      ...firstEntry,
      id: 'entry-2',
      photoId: 'photo-2',
      account: { ...firstEntry.account, nickname: 'lucka', displayName: 'Lucka' },
      imageUrl: 'https://cdn.test/photo-2.jpg',
    };
    await act(async () => {
      resolvePage({
        ...SNAPSHOT,
        entries: [firstEntry, freshEntry],
        entryCount: 2,
        nextCursor: null,
      });
      await deferredPage;
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getAllByLabelText(cs.a11y.contestOpenPhoto('@lucka'))).toHaveLength(1));

    const currentList = view.UNSAFE_getByType(FlatList);
    act(() => { void currentList.props.onEndReached(); });
    expect(mockFetchPhotoContestPage).toHaveBeenCalledTimes(1);
  });
});
