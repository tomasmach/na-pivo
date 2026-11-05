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
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/newlook/components/overlays', () => {
  const R = require('react');
  return {
    Sheet: ({ children, footer }: { children: unknown; footer: unknown }) => R.createElement(R.Fragment, null, children, footer),
    ButtonPair: () => null,
  };
});
jest.mock('@/data/account', () => ({ updateAccountPreferences: jest.fn() }));
jest.mock('@/map/mapModel', () => ({ pubOpeningVerdict: () => null }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const Linking = require('expo-linking');
const { nvBack } = require('@/newlook/navigation');
const { toast } = require('@/newlook/ui/store');
const { useSettingsStore } = require('@/stores/settingsStore');
const { useKompasState } = require('@/newlook/screens/kompas/state');
const { EMPTY_PUB_SEARCH_FILTERS } = require('@/data/pubSearchFilters');
const { FiltrySheet } = require('@/newlook/screens/kompas/FiltrySheet');

const k = t.nv.kompas;
const HOME = { lat: 50.08, lng: 14.42 };

function pressText(renderer: any, label: string) {
  const node = renderer.root.find(
    (n: any) =>
      typeof n.props.onPress === 'function' &&
      n.findAll((c: any) => c.type === 'Text' && [c.props.children].flat().join('') === label).length > 0 &&
      !n.findAll((c: any) => c !== n && typeof c.props.onPress === 'function').some((c: any) => c.findAll((x: any) => x.type === 'Text' && [x.props.children].flat().join('') === label).length > 0),
  );
  return node.props.onPress();
}

function render(): any {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(React.createElement(FiltrySheet));
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  act(() => {
    useKompasState.setState({ filters: EMPTY_PUB_SEARCH_FILTERS });
    useSettingsStore.setState({ homePoint: null, navigationProvider: 'google' });
  });
});

describe('Filtry sheet', () => {
  it('sends you to set a home point when none is set', () => {
    const renderer = render();
    act(() => pressText(renderer, k.navigateHome));
    expect(mockRouter.push).toHaveBeenCalledWith('/nv/domovsky-bod');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('navigates home on foot in the picked maps app', () => {
    act(() => {
      useSettingsStore.setState({ homePoint: HOME, navigationProvider: 'mapy' });
    });
    const renderer = render();
    act(() => pressText(renderer, k.navigateHome));
    expect(nvBack).toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('https://mapy.com/fnc/v1/route?end=14.42%2C50.08&routeType=foot_fast'));
  });

  it('says so when the maps app does not open', async () => {
    act(() => {
      useSettingsStore.setState({ homePoint: HOME });
    });
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('no app'));
    const renderer = render();
    await act(async () => pressText(renderer, k.navigateHome));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', title: k.navigationFailed }));
  });

  it('filters by practical amenities and stops at the server limit', () => {
    const renderer = render();
    for (const label of ['Platba kartou', 'Bezbariérový přístup', 'Wi-Fi', 'Parkování', t.nv.kompas.billiards]) {
      act(() => pressText(renderer, label));
    }
    expect(useKompasState.getState().filters.amenityKeys).toEqual(
      expect.arrayContaining(['payment_card', 'seating_barrier_free', 'practical_wifi', 'practical_parking', 'game_billiards']),
    );

    act(() => pressText(renderer, t.nv.kompas.foosball));
    expect(useKompasState.getState().filters.amenityKeys).toHaveLength(5);
    expect(useKompasState.getState().filters.amenityKeys).not.toContain('game_foosball');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: k.amenityLimit(5) }));
  });
});
