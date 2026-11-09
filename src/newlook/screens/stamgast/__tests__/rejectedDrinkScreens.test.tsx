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
jest.mock('@/newlook/components/chrome', () => {
  const R = require('react');
  return {
    Screen: ({ children, footer }: { children: unknown; footer?: unknown }) => R.createElement(R.Fragment, null, children, footer),
    BackHeader: () => null,
    BottomFade: () => null,
    useTabBarSpace: () => 0,
  };
});
jest.mock('@/newlook/screens/stamgast/PubVerdict', () => ({ PubVerdictSection: () => null, VerdictMark: () => null }));
jest.mock('@/myBeers/drinkEdits', () => ({ fixSessionDrink: jest.fn(() => true), deleteSessionDrink: jest.fn(() => true), renameSessionDrinks: jest.fn() }));
jest.mock('@/newlook/screens/stamgast/placeStore', () => ({
  useCountPlace: () => null,
  useBackfillPick: () => null,
}));
jest.mock('@/data/statsClient', () => ({ fetchMyStats: jest.fn(async () => null) }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { dialog } = require('@/newlook/ui/store');
const { fixSessionDrink, deleteSessionDrink } = require('@/myBeers/drinkEdits');
const { useTallyStore } = require('@/stores/tallyStore');
const { EveningDetailScreen, OpravitPivoSheet } = require('@/newlook/screens/stamgast/EveningSheets');
const { DiaryView } = require('@/newlook/screens/stamgast/DiaryView');

const at = (h: number) => new Date(2026, 9, 24, h).toISOString();
const evening: TallySession = {
  clientId: 'e1',
  pubKey: 'ctx:private',
  pubName: 'Doma',
  placeContext: 'private',
  startedAt: at(19),
  drinks: [
    { id: 'ok', at: at(19), beerName: 'Plzeň', syncStatus: 'sent' },
    { id: 'bad', at: at(20), beerName: 'Plzeň', priceCzk: 4000, syncStatus: 'rejected', rejectedField: 'beer.price_czk' },
  ],
};

function texts(renderer: any): string[] {
  return renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

let mounted: any = null;
async function render(Component: React.ComponentType): Promise<any> {
  await act(async () => {
    mounted = TestRenderer.create(React.createElement(Component));
  });
  return mounted;
}

beforeEach(() => {
  jest.clearAllMocks();
  useTallyStore.setState({ current: null, history: [evening] });
});

afterEach(async () => {
  if (mounted) await act(async () => mounted.unmount());
  mounted = null;
});

it('the diary says how many drinks did not save and opens their evening', async () => {
  const renderer = await render(DiaryView);
  expect(texts(renderer)).toContain(t.nv.stamgast.rejectedCount(1));

  await act(async () => renderer.root.find((n: any) => n.props.testID === 'diary-rejected' && typeof n.props.onPress === 'function').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/nv/vecer/[id]', params: { id: '2026-10-24' } });
});

it('the evening marks the refused drink and offers fix and remove', async () => {
  mockParams.current = { id: '2026-10-24' };
  const renderer = await render(EveningDetailScreen);
  const line = t.nv.stamgast.rejectedWhy(t.myBeers.fixDrinkHintPrice);
  expect(texts(renderer).filter((x) => x === line)).toHaveLength(1);

  const rejectedRow = renderer.root.find((n: any) => typeof n.props.onPress === 'function' && n.findAll((c: any) => c.props.testID === 'drink-rejected').length > 0);
  await act(async () => rejectedRow.props.onPress());
  const shown = dialog.mock.calls[0][0];
  expect(shown.body).toBe(line);
  expect(shown.actions.map((a: { label: string }) => a.label)).toEqual([t.myBeers.editDrinkCancel, t.nv.stamgast.fixDrink, t.myBeers.deleteDrinkConfirm]);

  shown.actions[1].onPress();
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/nv/opravit-pivo', params: { day: '2026-10-24', id: 'bad' } });

  shown.actions[2].onPress();
  const confirm = dialog.mock.calls[1][0];
  expect(confirm.title).toBe(t.myBeers.deleteDrinkTitle);
  confirm.actions[1].onPress();
  expect(deleteSessionDrink).toHaveBeenCalledWith(at(19), 'bad');
});

it('the fix form sends the corrected price again', async () => {
  mockParams.current = { day: '2026-10-24', id: 'bad' };
  const renderer = await render(OpravitPivoSheet);
  const save = () => renderer.root.find((n: any) => n.props.testID === 'drink-fix-save' && typeof n.props.onPress === 'function');
  const price = renderer.root.find((n: any) => n.props.testID === 'drink-fix-price' && typeof n.props.onChangeText === 'function');

  expect(price.props.autoFocus).toBe(true);
  expect(save().props.disabled).toBe(true);

  await act(async () => price.props.onChangeText('45'));
  expect(save().props.disabled).toBe(false);
  await act(async () => save().props.onPress());

  expect(fixSessionDrink).toHaveBeenCalledWith(at(19), expect.objectContaining({ id: 'bad' }), { beerName: 'Plzeň', drinkType: 'beer', priceCzk: 45 });
});

it('the counter removes a row drink through its own undo, not the diary edit', () => {
  const { drinkActions } = require('@/newlook/screens/stamgast/EveningSheets');
  const removeDrink = jest.fn(() => true);
  drinkActions(mockRouter, '2026-10-24', at(19), evening.drinks[0], { removeDrink });

  dialog.mock.calls[0][0].actions[2].onPress();
  dialog.mock.calls[1][0].actions[1].onPress();

  expect(removeDrink).toHaveBeenCalledWith('ok');
  expect(deleteSessionDrink).not.toHaveBeenCalled();
});
