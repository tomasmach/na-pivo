import React from 'react';
import { t } from '@/i18n';
import type { TallySession } from '@/stores/tallyStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
// The lean mock lacks the layout-animation builders the new look's motion presets chain at import.
jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const R = jest.requireActual('react');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = {
    Easing: { ...lean.Easing, bezier: () => (x: number) => x },
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    LayoutAnimationConfig: ({ children }: { children: React.ReactNode }) => R.createElement(R.Fragment, null, children),
  };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useFocusEffect: () => {},
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
const mockToast = jest.fn();
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: (...a: unknown[]) => mockToast(...a) }));
jest.mock('@/newlook/components/chrome', () => ({
  AvatarSlot: () => null,
  BottomFade: () => null,
  TabHeader: () => null,
  TopFade: () => null,
  useTabBarSpace: () => 100,
}));
jest.mock('@/newlook/duo/BookTab', () => ({ BookTab: ({ left }: { left: React.ReactNode }) => left }));
jest.mock('@/newlook/duo/layout', () => ({ useBook: () => ({ book: false }), useIsDuo: () => false }));
jest.mock('@/newlook/screens/tour/TourScreens', () => ({ TourRunContent: () => null }));
jest.mock('@/newlook/screens/stamgast/DiaryView', () => ({ DiaryView: () => null }));
jest.mock('@/newlook/screens/parta/FriendEveningCard', () => ({ FriendEveningCard: () => null, leaveFriendHome: jest.fn(), useFriendHomeEvening: () => null }));
jest.mock('@/newlook/screens/parta/tablemates', () => ({ useTablemates: () => [] }));
jest.mock('@/data/beersClient', () => ({
  fetchBeerPage: jest.fn(async () => ({ productKey: 'pilsner-urquell', styleSettled: false, myStyle: null, degree: 12, myDegree: null })),
  submitBeerStyle: jest.fn(async () => true),
}));
jest.mock('@/data/counterTelemetry', () => ({ trackCounterTabOpened: jest.fn() }));
jest.mock('@/data/telemetryClient', () => ({ trackClientEvent: jest.fn() }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
const mockPlace = { kind: 'pub', pub: { id: 'osm:1', name: 'U Zlatého tygra', lat: 50.08759, lng: 14.42108 } };
jest.mock('@/newlook/screens/stamgast/placeStore', () => ({
  OUTSIDE_ICON: { private: 'house', outdoors: 'tree-pine', other: 'map-pin' },
  currentCountPlace: () => mockPlace,
  useCountPlace: () => mockPlace,
  useCountPlaceHost: () => {},
  useNvPlaceStore: Object.assign(() => null, { getState: () => ({ picked: null, outside: null, setOutside: () => {} }) }),
}));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { placeKey } = require('@/counter/countDrink');
const { useTallyStore } = require('@/stores/tallyStore');
const { StamgastScreen } = require('@/newlook/screens/stamgast/StamgastScreen');

const QUEUE_KEY = 'na-pivo-friends-queue';
const startedAt = new Date(Date.now() - 20 * 60000).toISOString();
const session: TallySession = {
  clientId: 's1',
  pubKey: placeKey(mockPlace),
  pubName: 'U Zlatého tygra',
  startedAt,
  drinks: [{ id: 'a', at: startedAt, beerName: 'Pilsner Urquell 12°', volumeMl: 500, syncStatus: 'sent' as const }],
};

async function pressDopito() {
  useTallyStore.setState({ current: session, history: [] });
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(<StamgastScreen />);
  });
  const dopito = renderer.root.find((n: any) => n.props.accessibilityLabel === t.nv.stamgast.quickDone && typeof n.props.onPress === 'function');
  await act(async () => {
    dopito.props.onPress();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => renderer.unmount());
}

const droppedToast = expect.objectContaining({ title: t.nv.parta.pingDropped, sub: t.nv.parta.pingDroppedSub });

beforeEach(async () => {
  mockToast.mockClear();
  await AsyncStorage.clear();
});

it('says at Dopito that the ping still waiting for signal will not be sent', async () => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([
    { op: 'activity', clientId: 'ping', payload: { pub: mockPlace.pub, message: '', startedAt: new Date(Date.now() - 60000).toISOString() } },
  ]));
  await pressDopito();
  expect(mockToast).toHaveBeenCalledWith(droppedToast);
  expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]')).toEqual([]);
});

it('stays quiet at Dopito when no ping waits', async () => {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([{ op: 'friend-cheer', accountId: 'klara' }]));
  await pressDopito();
  expect(mockToast).not.toHaveBeenCalledWith(droppedToast);
  expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]')).toEqual([{ op: 'friend-cheer', accountId: 'klara' }]);
});
