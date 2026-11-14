import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AppState } from 'react-native';

import type { FriendsDashboard } from '@/data/friendsClient';

import { PartaScreen } from '../PartaScreen';
import { usePartaStore } from '../partaStore';
import { PARTA_REFRESH_MS } from '../useRefreshWhileOpen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
const mockFocused = { current: true };

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
  useIsFocused: () => mockFocused.current,
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

const DASHBOARD = {
  friends: [],
  presence: [],
  homePresence: [],
  incomingRequests: [],
  friendStats: {},
  settings: { shareDrinksWithParta: true, ghostMode: false },
  myPresence: null,
} as unknown as FriendsDashboard;

const load = jest.fn(async () => undefined);
let appStateHandlers: ((state: string) => void)[] = [];
const appStateChange = (state: string) => appStateHandlers.forEach((handler) => handler(state));

let mounted: any = null;

async function renderParta() {
  await act(async () => {
    mounted = TestRenderer.create(<PartaScreen />);
  });
  return mounted;
}

const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockFocused.current = true;
  (AppState as { currentState: string }).currentState = 'active';
  appStateHandlers = [];
  (AppState.addEventListener as jest.Mock).mockImplementation((_event, handler) => {
    appStateHandlers.push(handler);
    return { remove: () => (appStateHandlers = appStateHandlers.filter((other) => other !== handler)) };
  });
  usePartaStore.setState({ dashboard: DASHBOARD, plans: [], failed: false, loading: false, load });
});
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  jest.useRealTimers();
});

describe('Parta keeps itself fresh while it is open', () => {
  it('refreshes on its own while the tab is showing and the app is active', async () => {
    await renderParta();
    await wait(PARTA_REFRESH_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await wait(1);
    expect(load).toHaveBeenCalledTimes(1);
    await wait(PARTA_REFRESH_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('sends nothing while another tab is showing', async () => {
    mockFocused.current = false;
    await renderParta();
    await wait(PARTA_REFRESH_MS * 5);
    expect(load).not.toHaveBeenCalled();
  });

  it('sends nothing in the background and catches up once on the way back', async () => {
    await renderParta();
    await act(async () => appStateChange('background'));
    await wait(PARTA_REFRESH_MS * 5);
    expect(load).not.toHaveBeenCalled();
    await act(async () => appStateChange('active'));
    expect(load).toHaveBeenCalledTimes(1);
    await wait(PARTA_REFRESH_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not reload on a quick app switch right after a refresh', async () => {
    await renderParta();
    await act(async () => appStateChange('inactive'));
    await act(async () => appStateChange('active'));
    expect(load).not.toHaveBeenCalled();
  });

  it('refreshes at once when the list is pulled down and hides the spinner when done', async () => {
    let finish!: () => void;
    load.mockImplementationOnce(() => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))));
    const renderer = await renderParta();
    const control = () => renderer.root.findAll((n: any) => n.props.refreshControl)[0].props.refreshControl;
    await act(async () => control().props.onRefresh());
    expect(load).toHaveBeenCalledTimes(1);
    expect(control().props.refreshing).toBe(true);
    await act(async () => finish());
    expect(control().props.refreshing).toBe(false);
  });
});
