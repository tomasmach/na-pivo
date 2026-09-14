import React from 'react';
import { Image, Modal, Platform, Pressable } from 'react-native';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { PartaPhotoStrip } from '@/photos/PartaPhotoStrip';
import { cs } from '@/i18n/cs';
import { MODAL_DISMISS_MS, useLaunchModalMutex } from '@/stores/launchModalMutex';
import type { PartaFeedPhoto } from '@/data/beerPhotosClient';

const mockFetchPartaPhotoFeed = jest.fn();

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as typeof import('react-native');
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    ...actual,
    FlatList: ({
      data = [],
      renderItem,
      ...props
    }: {
      data?: unknown[];
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    }) =>
      ReactModule.createElement(
        'FlatList',
        props,
        data.map((item, index) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            { key: index },
            renderItem?.({ item, index }),
          ),
        ),
      ),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('@/data/beerPhotosClient', () => ({
  fetchPartaPhotoFeed: (...args: unknown[]) => mockFetchPartaPhotoFeed(...args),
}));

jest.mock('@/photos/ScalePressable', () => ({
  ScalePressable: ({ children, ...props }: React.ComponentProps<typeof Pressable>) => (
    <Pressable {...props}>{children}</Pressable>
  ),
}));

jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));

jest.mock('@/components/shared/IconGlyph', () => ({
  MapPinIcon: () => null,
  XIcon: () => null,
}));

jest.mock('@/stores/accountStore', () => ({
  selectAvatarUrl: (state: { avatarUrl: string | null }) => state.avatarUrl,
  selectNickname: (state: { nickname: string | null }) => state.nickname,
  useAccountStore: (selector: (state: { avatarUrl: null; nickname: string }) => unknown) =>
    selector({ avatarUrl: null, nickname: 'mach' }),
}));

jest.mock('@/stores/beerPhotosStore', () => ({
  useBeerPhotosStore: (selector: (state: { photos: never[] }) => unknown) =>
    selector({ photos: [] }),
}));

const FEED_PHOTO: PartaFeedPhoto = {
  id: 'photo-1',
  clientId: 'client-1',
  imageUrl: 'https://cdn.test/photo.jpg',
  caption: 'Pěna drží.',
  pubCacheKey: 'u4pruydq',
  pubName: 'U Zlatého tygra',
  pubCity: 'Praha',
  visibility: 'friends',
  takenAt: '2026-08-21T12:00:00.000Z',
  createdAt: '2026-08-21T12:00:01.000Z',
  inContest: false,
  account: {
    nickname: 'jarda',
    displayName: 'Jarda',
    avatarUrl: null,
  },
};

describe('PartaPhotoStrip viewer lifecycle', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-21T15:00:00.000Z'));
    Platform.OS = 'ios';
    mockFetchPartaPhotoFeed.mockReset();
    mockFetchPartaPhotoFeed.mockResolvedValue([FEED_PHOTO]);
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) useLaunchModalMutex.getState().release(holder);
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    const holder = useLaunchModalMutex.getState().holder;
    if (holder) act(() => useLaunchModalMutex.getState().release(holder));
    Platform.OS = originalOS;
    jest.useRealTimers();
  });

  it('keeps an open viewer alive when its source strip becomes empty and releases safely', async () => {
    const view = render(<PartaPhotoStrip refreshKey={1} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.press(screen.getByLabelText(cs.a11y.partaPhotoTile('jarda')));
    const modal = view.UNSAFE_getByType(Modal);
    const completeNativeDismiss = modal.props.onDismiss as () => void;
    const requestClose = modal.props.onRequestClose as () => void;
    const holder = useLaunchModalMutex.getState().holder;

    expect(modal.props.visible).toBe(true);
    expect(holder).not.toBeNull();

    mockFetchPartaPhotoFeed.mockResolvedValueOnce([]);
    view.rerender(<PartaPhotoStrip refreshKey={2} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.UNSAFE_getByType(Modal).props.visible).toBe(true);
    expect(screen.getByLabelText(cs.a11y.photoViewerClose)).toBeTruthy();
    expect(useLaunchModalMutex.getState().holder).toBe(holder);

    act(() => requestClose());
    expect(useLaunchModalMutex.getState().holder).toBe(holder);
    act(() => completeNativeDismiss());
    act(() => jest.advanceTimersByTime(MODAL_DISMISS_MS - 1));
    expect(useLaunchModalMutex.getState().holder).toBe(holder);

    act(() => jest.advanceTimersByTime(1));
    expect(useLaunchModalMutex.getState().holder).toBeNull();
  });

  it('shows a retry action when the fullscreen photo cannot load', async () => {
    const view = render(<PartaPhotoStrip refreshKey={1} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.press(screen.getByLabelText(cs.a11y.partaPhotoTile('jarda')));

    const viewerImage = view.UNSAFE_getAllByType(Image).find(
      (image) => image.props.resizeMode === 'contain',
    );
    expect(viewerImage).toBeDefined();
    fireEvent(viewerImage!, 'error');

    expect(screen.getByText(cs.photoDiary.viewerLoadError)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(cs.a11y.photoViewerRetry));
    expect(screen.queryByText(cs.photoDiary.viewerLoadError)).toBeNull();
  });
});
