import React from 'react';
import { StyleSheet } from 'react-native';

import type { PublishedNight } from '@/data/nightsClient';

import { FeedCard } from '../FeedScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/shared/GlassIconButton', () => ({ GlassIconButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  DicesIcon: () => null,
  MapPinIcon: () => null,
  MenuIcon: () => null,
  MessageSquareIcon: () => null,
  SearchIcon: () => null,
}));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/components/shared/UnderlineTabs', () => ({ UnderlineTabs: () => null }));
jest.mock('@/data/account', () => ({ ensureAccount: jest.fn() }));
jest.mock('@/data/nightsClient', () => ({
  clearNightReaction: jest.fn(),
  fetchNightsFeed: jest.fn(),
  isRetriableNightError: jest.fn(),
  reactToNight: jest.fn(),
}));
jest.mock('@/data/nightsQueue', () => ({ enqueueNightOp: jest.fn() }));
jest.mock('@/feed/CheersButton', () => ({
  CheersButton: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react');
    return ReactModule.createElement('CheersButton', props);
  },
}));
jest.mock('@/feed/feedCache', () => ({
  loadNightFeedCache: jest.fn(),
  saveNightFeedCache: jest.fn(),
}));
jest.mock('@/feed/useNightActions', () => ({ useNightActions: () => jest.fn() }));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/mocks/mockTheme', () => ({ MockLayout: { screenPad: 20 } }));
jest.mock('@/profile/Avatar', () => ({
  Avatar: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react');
    return ReactModule.createElement('Avatar', props);
  },
}));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: jest.fn() }));
jest.mock('@/stores/toastStore', () => ({ useToastStore: jest.fn() }));
jest.mock('@/theme/fonts', () => ({
  Fonts: { numeral: 'numeral' },
  FontScaleCap: { heading: 1.2, body: 1.3 },
}));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function night(overrides: Partial<PublishedNight> = {}): PublishedNight {
  return {
    id: 'night-1',
    author: {
      id: 'author-1',
      nickname: 'honza',
      displayName: 'Honza',
      avatarUrl: 'https://cdn.example/avatar.jpg',
      isPublic: true,
    },
    drinkingDay: '2026-08-05',
    startedAt: '2026-08-05T19:00:00',
    endedAt: '2026-08-05T22:00:00',
    beerCount: 4,
    wineCount: 0,
    softDrinkCount: 0,
    shotCount: 0,
    pubNames: [],
    city: '',
    durationMinutes: null,
    title: '',
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    commentCount: 0,
    visibility: 'public',
    createdAt: '2026-08-05T22:05:00',
    rounds: 2,
    myRound: false,
    isMine: false,
    ...overrides,
  };
}

function flatTexts(renderer: {
  root: { findAllByType: (type: string) => { props: { children: unknown } }[] };
}): string[] {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node) => {
      const value = node.props.children;
      return typeof value === 'string' || typeof value === 'number' ? [String(value)] : [];
    });
}

describe('FeedCard', () => {
  it('renders a sparse API night without placeholder sections or image URLs', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FeedCard night={night()} />);
    });

    const texts = flatTexts(renderer!);
    expect(texts).toEqual(expect.arrayContaining(['@honza', 'Pivní večer', '4', 'Piva']));
    expect(texts).not.toEqual(
      expect.arrayContaining(['Hospody', 'Večer', 'Hráči', 'Fotky', 'Komentáře']),
    );
    expect(renderer!.root.findByType('Avatar').props.uri).toBe(
      'https://cdn.example/avatar.jpg',
    );
    expect(renderer!.root.findByType('CheersButton').props.disabled).toBe(true);
  });

  it('forwards a round tap with the real night id object', () => {
    const onToggleReaction = jest.fn();
    const publishedNight = night({ pubNames: ['U Zlatého tygra'], durationMinutes: 180 });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <FeedCard night={publishedNight} onToggleReaction={onToggleReaction} />,
      );
    });

    act(() => {
      renderer!.root.findByType('CheersButton').props.onPress();
    });

    expect(onToggleReaction).toHaveBeenCalledWith(publishedNight);
    expect(renderer!.root.findByType('CheersButton').props.disabled).toBe(false);
  });

  it('opens the real author profile from the card header', () => {
    const onOpenAuthor = jest.fn();
    const publishedNight = night();
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <FeedCard night={publishedNight} onOpenAuthor={onOpenAuthor} />,
      );
    });

    const profileButton = renderer!.root.findByProps({ accessibilityLabel: 'Profil @honza' });
    act(() => profileButton.props.onPress());

    expect(onOpenAuthor).toHaveBeenCalledWith(publishedNight);
  });

  it('keeps the moderation menu separate from opening the author', () => {
    const onOpenAuthor = jest.fn();
    const onOpenActions = jest.fn();
    const publishedNight = night();
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <FeedCard
          night={publishedNight}
          onOpenAuthor={onOpenAuthor}
          onOpenActions={onOpenActions}
        />,
      );
    });

    const menu = renderer!.root.findByProps({ accessibilityLabel: 'Možnosti večera' });
    act(() => menu.props.onPress());

    expect(onOpenActions).toHaveBeenCalledWith(publishedNight);
    expect(onOpenAuthor).not.toHaveBeenCalled();
  });

  it('opens detail from the story while keeping the horizontal hero outside that tap target', () => {
    const onOpenNight = jest.fn();
    const publishedNight = night({
      title: 'Čtyři kousky a domů',
      pubNames: ['U Zlatého tygra'],
      heroPhotos: [{ id: 'photo-1', imageUrl: 'https://cdn.example/night.jpg', caption: '' }],
      commentCount: 3,
    });
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <FeedCard night={publishedNight} onOpenNight={onOpenNight} />,
      );
    });

    const story = renderer!.root.findByProps({
      accessibilityLabel: 'Otevřít večer Čtyři kousky a domů',
    });
    act(() => story.props.onPress());

    expect(onOpenNight).toHaveBeenCalledTimes(1);
    expect(onOpenNight).toHaveBeenCalledWith(publishedNight);
    const heroStrip = renderer!.root.findByProps({ accessibilityLabel: 'Momentky večera' });
    expect(heroStrip.props.horizontal).toBe(true);
    expect(heroStrip.props.onPress).toBeUndefined();
  });

  it('does not repeat a route that is already summarized in the night header', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <FeedCard night={night({ pubNames: ['U Zlatého tygra', 'Lokál Dlouhááá'] })} />,
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'night-route-tile' })).toHaveLength(0);
  });

  it('keeps the route aligned with photos in a mixed hero strip', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <FeedCard
          night={night({
            pubNames: ['U Zlatého tygra', 'Lokál Dlouhááá'],
            heroPhotos: [{ id: 'photo-1', imageUrl: 'https://cdn.example/night.jpg', caption: '' }],
          })}
        />,
      );
    });

    const routeTile = renderer!.root.findByProps({ testID: 'night-route-tile' });
    expect(StyleSheet.flatten(routeTile.props.style).height).toBe(164);
  });
});
