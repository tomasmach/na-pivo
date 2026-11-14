import React from 'react';
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

const mockParams: { current: Record<string, string> } = { current: {} };
const mockRouter = { push: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/newlook/components/overlays', () => {
  const R = require('react');
  return { Sheet: ({ children, footer }: { children: unknown; footer?: unknown }) => R.createElement(R.Fragment, null, children, footer) };
});
jest.mock('@/newlook/screens/stamgast/PubVerdict', () => ({ PubVerdictSection: () => null, VerdictMark: () => null }));
jest.mock('@/myBeers/drinkEdits', () => ({ fixSessionDrink: jest.fn(() => true), deleteSessionDrink: jest.fn(() => true), renameSessionDrinks: jest.fn() }));
jest.mock('@/counter/countDrink', () => ({ ...jest.requireActual('@/counter/countDrink'), countDrink: jest.fn() }));
jest.mock('@/newlook/screens/stamgast/placeStore', () => ({
  useCountPlace: () => null,
  useBackfillPick: Object.assign(() => null, { getState: () => ({ set: () => {} }) }),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { countDrink } = require('@/counter/countDrink');
const { fixSessionDrink } = require('@/myBeers/drinkEdits');
const { useTallyStore } = require('@/stores/tallyStore');
const { useSettingsStore } = require('@/stores/settingsStore');
const { DopsatSheet, OpravitPivoSheet } = require('@/newlook/screens/stamgast/EveningSheets');
const { dayKeyOf } = require('@/newlook/screens/stamgast/eveningData');
const { t } = require('@/i18n');

const yesterday = () => dayKeyOf(new Date(Date.now() - 86400000));

const at = (h: number) => new Date(2026, 9, 24, h).toISOString();
const evening: TallySession = {
  clientId: 'e1',
  pubKey: 'ctx:private',
  pubName: 'Doma',
  placeContext: 'private',
  startedAt: at(18),
  drinks: [
    { id: 'ok', at: at(19), beerName: 'Budvar', priceCzk: 75, syncStatus: 'sent' },
    { id: 'bad', at: at(18), beerName: 'Budvar', priceCzk: 4000, syncStatus: 'rejected', rejectedField: 'beer.price_czk' },
  ],
};

let mounted: any = null;
async function render(Component: React.ComponentType): Promise<any> {
  await act(async () => {
    mounted = TestRenderer.create(React.createElement(Component));
  });
  return mounted;
}

const byTestId = (renderer: any, id: string) => renderer.root.find((n: any) => n.props.testID === id && (typeof n.props.onChangeText === 'function' || typeof n.props.onPress === 'function'));

async function backfill(typed?: string): Promise<number | undefined> {
  mockParams.current = { day: yesterday() };
  const renderer = await render(DopsatSheet);
  const price = byTestId(renderer, 'backfill-price-0');
  if (typed !== undefined) await act(async () => price.props.onChangeText(typed));
  const save = renderer.root.find((n: any) => n.props.label === t.nv.stamgast.backfillSave && typeof n.props.onPress === 'function');
  expect(save.props.disabled).toBe(false);
  await act(async () => save.props.onPress());
  return countDrink.mock.calls[0]?.[1].priceCzk;
}

beforeEach(() => {
  jest.clearAllMocks();
  useTallyStore.setState({ current: null, history: [evening] });
});

afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
  useSettingsStore.getState().setPriceCurrency('CZK', 1);
});

describe('Dopsat in euros', () => {
  beforeEach(() => useSettingsStore.getState().setPriceCurrency('EUR', 24.4));

  it('shows the last crown price in euros', async () => {
    mockParams.current = { day: yesterday() };
    const renderer = await render(DopsatSheet);
    expect(byTestId(renderer, 'backfill-price-0').props.value).toBe('3.07');
  });

  it('stores 5 € as its crown price', async () => {
    expect(await backfill('5')).toBe(122);
  });

  it('takes a decimal comma', async () => {
    expect(await backfill('3,5')).toBe(85);
  });

  it('keeps the pre-filled price as the crowns it came from', async () => {
    expect(await backfill()).toBe(75);
  });
});

describe('Dopsat in crowns', () => {
  it('keeps 75 Kč as 75', async () => {
    mockParams.current = { day: yesterday() };
    const renderer = await render(DopsatSheet);
    expect(byTestId(renderer, 'backfill-price-0').props.value).toBe('75');
    await act(async () => mounted.unmount());
    mounted = null;
    expect(await backfill()).toBe(75);
  });
});

it('the fix form of a refused drink converts a euro price', async () => {
  useSettingsStore.getState().setPriceCurrency('EUR', 24.4);
  mockParams.current = { day: '2026-10-24', id: 'bad' };
  const renderer = await render(OpravitPivoSheet);
  await act(async () => byTestId(renderer, 'drink-fix-price').props.onChangeText('4,5'));
  await act(async () => byTestId(renderer, 'drink-fix-save').props.onPress());
  expect(fixSessionDrink).toHaveBeenCalledWith(at(18), expect.objectContaining({ id: 'bad' }), { beerName: 'Budvar', drinkType: 'beer', priceCzk: 110 });
});
