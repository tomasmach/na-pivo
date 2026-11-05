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
const mockPlace = { kind: 'outside', context: 'private' };
jest.mock('@/newlook/screens/stamgast/placeStore', () => ({
  OUTSIDE_ICON: { private: 'house', outdoors: 'tree-pine', other: 'map-pin' },
  useCountPlace: () => mockPlace,
  useBackfillPick: () => null,
  useNvPlaceStore: Object.assign(() => null, { getState: () => ({}) }),
}));
jest.mock('@/newlook/screens/stamgast/pubMenu', () => ({
  usePubMenu: () => ({ beers: [], historicalBeers: [], fresh: false, loading: false }),
  addBeersToMenu: jest.fn(),
}));
jest.mock('@/newlook/screens/piva/model', () => ({ myRating: () => null }));
jest.mock('@/newlook/screens/piva/useMyRatings', () => ({ useMyRatings: () => new Map() }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { logDrink } = require('@/newlook/screens/stamgast/counterActions');
const { useTallyStore } = require('@/stores/tallyStore');
const { ZapisSheet } = require('@/newlook/screens/stamgast/ZapisSheets');

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

beforeEach(() => {
  jest.clearAllMocks();
  useTallyStore.setState({ current: null, history: [] });
});

afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
});

it('logs a wine under the name the user typed', async () => {
  const renderer = await renderSheet();
  await act(async () => pressText(renderer, copy.kindWine));
  await act(async () => pressText(renderer, copy.customTile.vino));

  const input = renderer.root.find((n: any) => n.props.testID === 'drink-custom-name' && typeof n.props.onChangeText === 'function');
  await act(async () => input.props.onChangeText('  Ryzlink vlašský '));
  await act(async () => saveButton(renderer).props.onPress());

  expect(logDrink).toHaveBeenCalledTimes(1);
  expect(logDrink.mock.calls[0][1]).toEqual({ name: 'Ryzlink vlašský', drinkType: 'wine', volumeMl: 200 });
});

it('will not log an empty or blank name and says why', async () => {
  const renderer = await renderSheet();
  await act(async () => pressText(renderer, copy.kindShot));
  await act(async () => pressText(renderer, copy.customTile.panak));

  expect(saveButton(renderer).props.disabled).toBe(true);
  expect(texts(renderer)).toContain(copy.customNameMissing);

  const input = renderer.root.find((n: any) => n.props.testID === 'drink-custom-name' && typeof n.props.onChangeText === 'function');
  await act(async () => input.props.onChangeText('   '));
  expect(saveButton(renderer).props.disabled).toBe(true);
  expect(logDrink).not.toHaveBeenCalled();
});

it('offers a typed soft drink again among the recent ones', async () => {
  const session: TallySession = {
    clientId: 's1',
    pubKey: 'ctx:private',
    pubName: 'Doma',
    placeContext: 'private',
    startedAt: new Date(2026, 9, 24, 19).toISOString(),
    drinks: [{ id: 'd1', at: new Date(2026, 9, 24, 19).toISOString(), beerName: 'Mattoni', drinkType: 'soft_drink' }],
  };
  useTallyStore.setState({ current: null, history: [session] });
  const renderer = await renderSheet();
  await act(async () => pressText(renderer, copy.kindSoft));

  expect(texts(renderer)).toContain('Mattoni');
});
