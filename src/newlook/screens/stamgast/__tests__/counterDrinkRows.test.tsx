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
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
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

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { placeKey } = require('@/counter/countDrink');
const { useTallyStore } = require('@/stores/tallyStore');
const { useCounterNudges } = require('@/newlook/screens/stamgast/counterActions');
const { StamgastScreen } = require('@/newlook/screens/stamgast/StamgastScreen');

const startedAt = new Date(Date.now() - 20 * 60000).toISOString();
const drink = (id: string, minutes: number) => ({ id, at: new Date(Date.now() - minutes * 60000).toISOString(), beerName: 'Pilsner Urquell 12°', volumeMl: 500, syncStatus: 'sent' as const });
const session: TallySession = {
  clientId: 's1',
  pubKey: placeKey(mockPlace),
  pubName: 'U Zlatého tygra',
  startedAt,
  drinks: [drink('a', 15), drink('b', 10), drink('c', 5)],
};

function texts(renderer: any): string[] {
  return renderer.root
    .findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')
    .map((n: any) => [n.props.children].flat().join(''));
}

function stepper(renderer: any, testID: string, name: string): any {
  return renderer.root.find((n: any) => n.props.testID === testID && n.props.accessibilityLabel?.endsWith(name) && typeof n.props.onPress === 'function');
}

it('keeps the minus above the beer style question and the story row', async () => {
  useTallyStore.setState({ current: session, history: [] });
  useCounterNudges.getState().set({ newBeer: { name: 'Pilsner Urquell 12°', pubName: 'U Zlatého tygra' }, stickerFor: 's1', tourBanner: null });

  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(<StamgastScreen />);
  });

  const order = texts(renderer);
  const row = order.indexOf('Pilsner Urquell 12°');
  const question = order.indexOf(t.nv.piva.stylePick.nudgeTitle('Pilsner Urquell 12°'));
  const story = order.indexOf(t.nv.stamgast.stickerTitle(3));

  expect(stepper(renderer, 'counter-row-minus', 'Pilsner Urquell 12°')).toBeTruthy();
  expect(row).toBeGreaterThan(-1);
  expect(question).toBeGreaterThan(-1);
  expect(story).toBeGreaterThan(-1);
  expect(row).toBeLessThan(question);
  expect(row).toBeLessThan(story);
  await act(async () => renderer.unmount());
});

it('folds identical drinks into one row whose plus logs another without asking', async () => {
  const shot = (id: string, minutes: number) => ({ ...drink(id, minutes), beerName: 'Fernet Stock', volumeMl: 40, drinkType: 'shot' as const, priceCzk: 75 });
  useTallyStore.setState({ current: { ...session, drinks: [drink('a', 15), shot('f1', 3), shot('f2', 1)] }, history: [] });
  useCounterNudges.getState().set({ newBeer: null, stickerFor: null, tourBanner: null });
  const { dialog } = require('@/newlook/ui/store');
  dialog.mockClear();

  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(<StamgastScreen />);
  });
  expect(texts(renderer).filter((x) => x === 'Fernet Stock')).toHaveLength(1);
  expect(texts(renderer)).toContain('2');

  await act(async () => stepper(renderer, 'counter-row-plus', 'Fernet Stock').props.onPress());

  const drinks = useTallyStore.getState().current!.drinks;
  expect(dialog).not.toHaveBeenCalled();
  expect(drinks).toHaveLength(4);
  expect(drinks[3]).toMatchObject({ beerName: 'Fernet Stock', drinkType: 'shot', volumeMl: 40, priceCzk: 75 });
  expect(texts(renderer)).toContain('3');

  await act(async () => stepper(renderer, 'counter-row-minus', 'Fernet Stock').props.onPress());
  expect(useTallyStore.getState().current!.drinks.map((d: { id: string }) => d.id)).toEqual(['a', 'f1', 'f2']);
  await act(async () => renderer.unmount());
});
