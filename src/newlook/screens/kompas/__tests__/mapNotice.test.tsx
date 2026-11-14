import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { EMPTY_PUB_SEARCH_FILTERS } from '@/data/pubSearchFilters';
import { t } from '@/i18n';

import { KompasScreen } from '../KompasScreen';
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
  const passThrough = ({ children }: { children?: unknown }) => children;
  const extra = {
    Easing: { ...lean.Easing, bezier: () => (x: number) => x },
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    LayoutAnimationConfig: passThrough,
  };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, PROVIDER_GOOGLE: 'google' }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/newlook/screens/kompas/NvMap', () => ({ NvMap: () => null }));

const mockKompas: { current: Record<string, unknown> } = { current: {} };
jest.mock('@/newlook/screens/kompas/useKompas', () => ({
  useKompas: () => mockKompas.current,
  pinId: () => '',
}));

const requestPermission = jest.fn(async () => undefined);
const PRAGUE = { lat: 50.0876, lng: 14.4211, accuracyMeters: 10 };
const AREA = { lat: 50.0876, lng: 14.4211, radiusKm: 2 };
const PIN = { key: 'u2fkbn6c', id: 'u2fkbn6c:1:U Tygra', lat: 50.085, lng: 14.419, label: null, beers: 0, restaurant: false };

function kompas(
  over: { permissionState?: string; position?: unknown; pins?: unknown[]; filterCount?: number; searchArea?: unknown; loadingPubs?: boolean; loadedPubs?: unknown[] } = {},
) {
  const position = over.position === undefined ? null : over.position;
  return {
    target: null,
    position,
    pins: over.pins ?? [],
    mapPubs: [],
    filterCount: over.filterCount ?? 0,
    hideClosed: false,
    beersByPub: null,
    state: 'location',
    map: {
      permissionState: over.permissionState ?? 'undetermined',
      position,
      searchArea: over.searchArea === undefined ? null : over.searchArea,
      loadingPubs: over.loadingPubs ?? false,
      loadedPubs: over.loadedPubs ?? [],
      livePubs: [],
      visitedCities: [],
      visitedPubs: [],
      requestPermission,
      refreshPosition: jest.fn(),
      loadRegion: jest.fn(),
    },
    compass: { requestPermission: jest.fn(), heading: 0 },
  };
}

function texts(root: ReactTestRenderer): string[] {
  return root.root.findAll((n) => typeof n.props.children === 'string').map((n) => n.props.children as string);
}

const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let root!: ReactTestRenderer;
  act(() => {
    root = create(<KompasScreen />);
  });
  mounted.push(root);
  return root;
}

afterEach(() => {
  act(() => mounted.splice(0).forEach((root) => root.unmount()));
});

function press(root: ReactTestRenderer, label: string) {
  const button = root.root.find((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label);
  act(() => button.props.onPress());
}

const K = () => t.nv.kompas;

beforeEach(() => {
  requestPermission.mockClear();
  useKompasState.setState({ view: 'map', mapView: 'okoli', browsingWithoutLocation: false, filters: EMPTY_PUB_SEARCH_FILTERS });
});

test('a map that was never given location says why it is empty and asks for it', () => {
  mockKompas.current = kompas({ permissionState: 'undetermined' });
  const root = render();
  expect(texts(root)).toContain(K().mapLocationAsk);
  press(root, K().locationCta);
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

test('a map with location denied sends the person to Settings and says so', () => {
  mockKompas.current = kompas({ permissionState: 'denied' });
  const root = render();
  expect(texts(root)).toContain(K().mapLocationDenied);
  press(root, t.permissions.openSettings);
  expect(requestPermission).toHaveBeenCalledTimes(1);
});

test('a map with location shows no explanation', () => {
  mockKompas.current = kompas({ permissionState: 'granted', position: PRAGUE, pins: [PIN], searchArea: AREA });
  const root = render();
  expect(texts(root)).not.toContain(K().mapLocationAsk);
  expect(texts(root)).not.toContain(K().mapEmpty);
});

test('a person who chose to browse without location is not asked again', () => {
  useKompasState.setState({ browsingWithoutLocation: true });
  mockKompas.current = kompas({ permissionState: 'undetermined' });
  const root = render();
  expect(texts(root)).not.toContain(K().mapLocationAsk);
});

test('a filter that hides every pub here says so and offers to clear it', () => {
  mockKompas.current = kompas({ permissionState: 'granted', position: PRAGUE, filterCount: 1, searchArea: AREA, loadedPubs: [{ id: '1', name: 'U Tygra', lat: 50.085, lng: 14.419 }] });
  const root = render();
  expect(texts(root)).toContain(K().noResultsBody);
  expect(texts(root)).not.toContain(K().summaryAll);
  press(root, K().clearFilters);
  expect(useKompasState.getState().filters.amenityKeys).toEqual([]);
});

test('a server-side filter with no match here says so', () => {
  useKompasState.getState().setFilters({ amenityKeys: ['game_darts'] });
  mockKompas.current = kompas({ permissionState: 'granted', position: PRAGUE, filterCount: 1, searchArea: AREA });
  expect(texts(render())).toContain(K().noResultsBody);
});

test('a place with no pubs at all does not blame the open-now filter', () => {
  mockKompas.current = kompas({ permissionState: 'granted', position: PRAGUE, filterCount: 1, searchArea: AREA });
  const root = render();
  expect(texts(root)).toContain(K().mapEmpty);
  expect(texts(root)).not.toContain(K().noResultsBody);
});

test('a place with no pubs says so, but not while loading or zoomed out past the search', () => {
  mockKompas.current = kompas({ permissionState: 'granted', position: PRAGUE, searchArea: AREA });
  expect(texts(render())).toContain(K().mapEmpty);
  mockKompas.current = kompas({ permissionState: 'granted', position: PRAGUE, searchArea: AREA, loadingPubs: true });
  expect(texts(render())).not.toContain(K().mapEmpty);
  mockKompas.current = kompas({ permissionState: 'granted', position: PRAGUE });
  expect(texts(render())).not.toContain(K().mapEmpty);
});
