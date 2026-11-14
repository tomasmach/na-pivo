import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { FriendProfile, FriendsDashboard } from '@/data/friendsClient';
import { t } from '@/i18n';

import { PartaScreen } from '../PartaScreen';
import { usePartaStore } from '../partaStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  const { View, ScrollView } = jest.requireActual('react-native');
  const Animated = { ...lean.default, View, ScrollView };
  return new Proxy({ ...lean, ...extra, default: Animated, __esModule: true }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
  useIsFocused: () => false,
}));
jest.mock('expo-location', () => ({}));
jest.mock('expo-calendar/legacy', () => ({}));
jest.mock('../PartaPhotos', () => ({ FriendPhotosSection: () => null, PartaPhotoStrip: () => null }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/newlook/components/chrome', () => ({
  TabHeader: () => null,
  TopFade: () => null,
  BottomFade: () => null,
  useTabBarSpace: () => 0,
  useTabHeaderScroll: () => undefined,
}));
jest.mock('@/newlook/duo/BookTab', () => ({ BookTab: ({ left }: { left: React.ReactNode }) => left }));

function friend(id: string, name: string): FriendProfile {
  return { id, nickname: id, displayName: name, avatarUrl: null, isPublic: false } as FriendProfile;
}

const marek = friend('marek', 'Marek');
const jana = friend('jana', 'Jana');
const petr = friend('petr', 'Petr');

function dashboard(): FriendsDashboard {
  return {
    friends: [marek, jana, petr],
    presence: [{ account: marek, pubName: 'Lokál', beers: 2, reactions: { cheers: 0 }, myReaction: null }],
    homePresence: [{ account: jana }],
    incomingRequests: [],
    friendStats: {},
    settings: { shareDrinksWithParta: true, ghostMode: false },
    myPresence: null,
  } as unknown as FriendsDashboard;
}

function texts(root: any): string[] {
  return root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

async function renderParta() {
  usePartaStore.setState({ dashboard: dashboard(), plans: [], failed: false, loading: false });
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(<PartaScreen />);
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('people in Parta', () => {
  it.each([
    ['in a pub', 'Marek', 'marek'],
    ['at someone’s home', 'Jana', 'jana'],
  ])('opens a friend who is out (%s) from Teď venku', async (_where, name, id) => {
    const renderer = await renderParta();
    const live = renderer.root.find(
      (n: any) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(`${name}, `),
    );
    expect(live.props.accessibilityRole).toBe('button');
    act(() => live.props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/nv/kamos/[id]', params: { id } });
  });

  it('lists every friend under Celá parta, matching its count', async () => {
    const renderer = await renderParta();
    const all = texts(renderer.root);
    const head = all.indexOf(t.nv.parta.wholeParty);
    expect(all[head + 1]).toBe('3');
    const listed = renderer.root.findAll((n: any) => n.props.chevron === true && typeof n.props.selected === 'boolean').map((n: any) => n.props.title);
    expect(listed).toEqual(['Marek', 'Jana', 'Petr']);
  });
});
