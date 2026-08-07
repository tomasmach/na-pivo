/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from 'react';

import type { BeerPhotoLocal } from '@/stores/beerPhotosStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEnqueueBeerPhoto = jest.fn();
const mockRemoveQueuedBeerPhoto = jest.fn();
const mockShowAppDialog = jest.fn();
const mockShowToast = jest.fn();
const mockRemovePhoto = jest.fn();
const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
  replace: jest.fn(),
};

let mockPhoto: BeerPhotoLocal = {
  id: null,
  clientId: 'party-photo',
  imageUrl: null,
  localUri: 'file:///docs/beer-photos/party-photo.jpg',
  caption: 'Od stolu',
  pubCacheKey: 'pub-1',
  pubName: 'U Fleků',
  pubCity: 'Praha',
  partyCode: 'STUL24',
  partyDrinkingDay: '2026-08-06',
  visibility: 'friends',
  takenAt: '2026-08-06T21:00:00.000Z',
  createdAt: '2026-08-06T21:00:00.000Z',
  inContest: false,
  syncState: 'failed',
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ key: 'party-photo' }),
  useRouter: () => mockRouter,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({
  showAppDialog: (...args: unknown[]) => mockShowAppDialog(...args),
}));
jest.mock('@/components/shared/GlowButton', () => ({ GlowButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
  ChevronRightIcon: () => null,
  ClockIcon: () => null,
  EyeOffIcon: () => null,
  InfoIcon: () => null,
  MapPinIcon: () => null,
  RefreshCwIcon: () => null,
  Trash2Icon: () => null,
  TrophyIcon: () => null,
  UsersIcon: () => null,
}));
jest.mock('@/data/beerPhotosClient', () => ({ deleteBeerPhoto: jest.fn() }));
jest.mock('@/data/beerPhotosQueue', () => ({
  deleteBeerPhotoLocalFile: jest.fn(),
  enqueueBeerPhoto: (...args: unknown[]) => mockEnqueueBeerPhoto(...args),
  removeQueuedBeerPhoto: (...args: unknown[]) => mockRemoveQueuedBeerPhoto(...args),
}));
jest.mock('@/data/photoContestClient', () => ({ enterPhotoContest: jest.fn() }));
jest.mock('@/stores/beerPhotosStore', () => ({
  loadBeerPhotos: jest.fn(),
  useBeerPhotosStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ photos: [mockPhoto], removePhoto: mockRemovePhoto }),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));

import { Pressable } from 'react-native';

import { cs } from '@/i18n/cs';
import BeerPhotoDetailScreen from '@/photos/BeerPhotoDetailScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

describe('BeerPhotoDetailScreen retry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPhoto = {
      ...mockPhoto,
      id: null,
      imageUrl: null,
      localUri: 'file:///docs/beer-photos/party-photo.jpg',
      syncState: 'failed',
    };
    mockEnqueueBeerPhoto.mockResolvedValue({
      persisted: true,
      completion: Promise.resolve(),
    });
    mockRemoveQueuedBeerPhoto.mockResolvedValue(true);
  });

  it('keeps both Party associations when re-enqueuing a failed photo', async () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<BeerPhotoDetailScreen />);
    });

    const retry = renderer!.root
      .findAllByType(Pressable)
      .find((node: { props: { accessibilityLabel?: string } }) =>
        node.props.accessibilityLabel === cs.a11y.photoRetry,
      );
    expect(retry).toBeDefined();

    await act(async () => {
      await retry!.props.onPress();
    });

    expect(mockEnqueueBeerPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'party-photo',
        partyCode: 'STUL24',
        partyDrinkingDay: '2026-08-06',
      }),
    );
    expect(mockShowToast).toHaveBeenCalledWith(
      cs.photoDiary.retryQueuedToast,
      expect.any(Object),
    );
  });

  it('routes a synced photo through the same durable client-id tombstone delete', async () => {
    mockPhoto = {
      ...mockPhoto,
      id: 'server-photo',
      imageUrl: 'https://api.test/media/server-photo.webp',
      localUri: undefined,
      syncState: 'synced',
    };
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<BeerPhotoDetailScreen />);
    });

    const remove = renderer!.root
      .findAllByType(Pressable)
      .find((node: { props: { accessibilityLabel?: string } }) =>
        node.props.accessibilityLabel === cs.a11y.photoDelete,
      );
    act(() => remove!.props.onPress());
    const dialog = mockShowAppDialog.mock.calls[0][0] as {
      buttons: { style?: string; onPress?: () => void }[];
    };
    const confirm = dialog.buttons.find((button) => button.style === 'destructive');

    await act(async () => {
      confirm?.onPress?.();
      await Promise.resolve();
    });

    expect(mockRemoveQueuedBeerPhoto).toHaveBeenCalledWith('party-photo');
    expect(mockRemovePhoto).toHaveBeenCalledWith('party-photo');
    expect(mockShowToast).toHaveBeenCalledWith(cs.photoDiary.deletedToast);
    expect(cs.photoDiary.deletedToast).toContain('jakmile bude síť');
  });
});
