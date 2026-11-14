import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Pub } from '@/data/pubs';
import { t } from '@/i18n';

import { PubScreen } from '../PubScreen';
import { useKompasState } from '../state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, PROVIDER_GOOGLE: 'google' }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/data/pubReachClient', () => ({ trackPubReach: jest.fn() }));
jest.mock('@/newlook/screens/kompas/Regulars', () => ({ RegularsRow: () => null }));

const PUB = { id: 'osm:1', name: 'U Tygra', lat: 50.085, lng: 14.419, city: 'Praha' } as unknown as Pub;
jest.mock('@/newlook/screens/kompas/usePubPage', () => ({
  useParamPub: () => ({ key: 'u2fkbn6c', pub: PUB }),
  useRecentPosition: () => null,
  usePubDetails: () => ({
    pub: PUB,
    hoursLoaded: true,
    hours: { tone: 'unknown' },
    week: null,
    taps: [],
    events: [],
    beersLastWeek: null,
    mappedPercent: 0,
    visit: null,
    aggregates: undefined,
    identityKey: 'u2fkbn6c',
    now: new Date('2026-11-14T18:00:00Z'),
  }),
}));

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<PubScreen />);
  });
  return renderer;
}

describe('pub page buttons into the Kompas tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useKompasState.getState().set({ view: 'map', picked: null });
  });

  it('opens the compass aimed at the pub from a tab that was showing the map', async () => {
    const renderer = await render();
    await act(async () => renderer.root.findByProps({ label: t.nv.kompas.showOnCompass }).props.onPress());

    expect(useKompasState.getState().view).toBe('compass');
    expect(useKompasState.getState().picked).toBe(PUB);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/nv/kompas');
  });

  it('opens the map from the map preview even when the tab was showing the compass', async () => {
    useKompasState.getState().set({ view: 'compass' });
    const renderer = await render();
    const preview = renderer.root.findAll((node) => typeof node.props.onPress === 'function' && node.props.style?.height === 112)[0];
    await act(async () => preview.props.onPress());

    expect(useKompasState.getState().view).toBe('map');
    expect(useKompasState.getState().picked).toBe(PUB);
  });
});
