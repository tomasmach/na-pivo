import React from 'react';
import { t } from '@/i18n';

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
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});

const mockRouter = { push: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/newlook/components/overlays', () => {
  const R = require('react');
  return { Sheet: ({ children, footer }: { children: unknown; footer?: unknown }) => R.createElement(R.Fragment, null, children, footer) };
});
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/data/menuPhotoPicker', () => ({ pickAndPrepareMenuPhoto: jest.fn() }));
jest.mock('@/data/menuScanClient', () => ({ scanMenuPhoto: jest.fn() }));
jest.mock('@/data/beerLabelScanClient', () => ({ scanBeerLabel: jest.fn() }));
jest.mock('@/newlook/screens/stamgast/counterActions', () => ({ logDrink: jest.fn() }));
const mockPlace = { kind: 'pub', pub: { id: 'osm:1', name: 'U Zlatého tygra', lat: 50.08759, lng: 14.42108, city: 'Praha' } };
jest.mock('@/newlook/screens/stamgast/placeStore', () => ({
  OUTSIDE_ICON: { private: 'house', outdoors: 'tree-pine', other: 'map-pin' },
  useCountPlace: () => mockPlace,
  useBackfillPick: () => null,
  useNvPlaceStore: Object.assign(() => null, { getState: () => ({}) }),
}));
let mockMenu: { name: string; volumeMl?: number; priceCzk?: number }[] = [];
jest.mock('@/newlook/screens/stamgast/pubMenu', () => ({
  usePubMenu: () => ({ beers: mockMenu, historicalBeers: [], fresh: true, loading: false }),
  addBeersToMenu: jest.fn(),
}));
jest.mock('@/newlook/screens/piva/model', () => ({ myRating: () => null }));
jest.mock('@/newlook/screens/piva/useMyRatings', () => ({ useMyRatings: () => new Map() }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { logDrink } = require('@/newlook/screens/stamgast/counterActions');
const { useTallyStore } = require('@/stores/tallyStore');
const { ZapisSheet } = require('@/newlook/screens/stamgast/ZapisSheets');
const { useSettingsStore } = require('@/stores/settingsStore');

const copy = t.nv.stamgast;

function texts(renderer: any): string[] {
  return renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

function pressText(renderer: any, label: string) {
  const nodes = renderer.root.findAll(
    (n: any) => typeof n.props.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [c.props.children].flat().join('') === label).length > 0,
  );
  return nodes[nodes.length - 1].props.onPress();
}

function saveButton(renderer: any) {
  return renderer.root.find((n: any) => n.props.testID === 'drink-save' && typeof n.props.onPress === 'function');
}

let mounted: any = null;

async function renderSheet(): Promise<any> {
  await act(async () => {
    mounted = TestRenderer.create(React.createElement(ZapisSheet));
  });
  return mounted;
}

function priceField(renderer: any) {
  return renderer.root.find((n: any) => n.props.testID === 'drink-price' && typeof n.props.onChangeText === 'function');
}

function sizeCard(renderer: any, volume: string): string[] {
  const card = renderer.root.findAll(
    (n: any) => typeof n.props.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [c.props.children].flat().join('') === volume).length > 0,
  )[0];
  return card.findAll((c: any) => c.type === 'Text').map((c: any) => [c.props.children].flat().join(''));
}

beforeEach(() => {
  jest.clearAllMocks();
  useTallyStore.setState({ current: null, history: [] });
  useSettingsStore.setState({ priceCurrency: 'CZK' });
  mockMenu = [
    { name: 'Pilsner Urquell', volumeMl: 300, priceCzk: 45 },
    { name: 'Pilsner Urquell', volumeMl: 500, priceCzk: 59 },
  ];
});

afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
});

it('corrects only the picked size and shows the new price once the field closes', async () => {
  const renderer = await renderSheet();
  expect(texts(renderer)).toContain(copy.priceFor('0,5 l'));
  await act(async () => pressText(renderer, copy.edit));
  expect(priceField(renderer).props.value).toBe('59');

  await act(async () => priceField(renderer).props.onChangeText('62'));
  await act(async () => priceField(renderer).props.onBlur());

  expect(renderer.root.findAll((n: any) => n.props.testID === 'drink-price')).toHaveLength(0);
  expect(sizeCard(renderer, '0,5 l')).toContain('62 Kč');
  expect(sizeCard(renderer, '0,3 l')).toContain('45 Kč');
  await act(async () => saveButton(renderer).props.onPress());
  expect(logDrink.mock.calls[0][1]).toMatchObject({ name: 'Pilsner Urquell', priceCzk: 62, volumeMl: 500 });
});

it('logs the menu price when the field is cleared and shows it as the hint', async () => {
  const renderer = await renderSheet();
  await act(async () => pressText(renderer, copy.edit));
  await act(async () => priceField(renderer).props.onChangeText(''));

  expect(priceField(renderer).props.placeholder).toBe('59');
  await act(async () => saveButton(renderer).props.onPress());
  expect(logDrink.mock.calls[0][1]).toMatchObject({ priceCzk: 59, volumeMl: 500 });
});

it('adds a missing price from the row', async () => {
  mockMenu = [{ name: 'Kozel 11°', volumeMl: 500 }];
  const renderer = await renderSheet();
  await act(async () => pressText(renderer, copy.priceAdd));
  await act(async () => priceField(renderer).props.onChangeText('50'));
  await act(async () => saveButton(renderer).props.onPress());

  expect(logDrink.mock.calls[0][1]).toMatchObject({ name: 'Kozel 11°', priceCzk: 50, volumeMl: 500 });
});

it('takes the price in the currency the user picked', async () => {
  useSettingsStore.setState({ priceCurrency: 'EUR' });
  const renderer = await renderSheet();
  await act(async () => pressText(renderer, copy.edit));

  expect(priceField(renderer).props.value).toBe('2.36');
  expect(texts(renderer)).toContain('€');
  await act(async () => priceField(renderer).props.onChangeText('3'));
  await act(async () => saveButton(renderer).props.onPress());
  expect(logDrink.mock.calls[0][1]).toMatchObject({ priceCzk: 75 });
});
