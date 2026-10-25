import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { notificationsDenied } from '@/notifications/beerWatchPush';
import BeerWatchesScreen from '../BeerWatchesScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = {
  watches: [] as { productKey: string; name: string; aliases: string[] }[],
  radiusM: 3000,
  loaded: false,
  refresh: jest.fn(async () => true),
  setRadius: jest.fn(async () => true),
  unwatch: jest.fn(async () => true),
};

jest.mock('@/stores/beerWatchStore', () => {
  const useBeerWatchStore = (selector: (s: unknown) => unknown) => selector(mockState);
  useBeerWatchStore.getState = () => mockState;
  return { useBeerWatchStore };
});
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
  useRouter: () => ({ canGoBack: () => true, back: jest.fn(), replace: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronLeftIcon: () => null, XIcon: () => null }));
jest.mock('@/friends/SectionHeader', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return function SectionHeader({ label }: { label: string }) {
    return <Text>{label}</Text>;
  };
});
jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted' },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}));
jest.mock('@/notifications/beerWatchPush', () => ({ notificationsDenied: jest.fn(async () => false) }));
jest.mock('../beerWatchLocation', () => ({ syncBeerWatchLocation: jest.fn(async () => undefined) }));

const WATCH = { productKey: 'e2e-hlidana-12', name: 'E2E Hlídaná 12°', aliases: [] };

let renderer: TestRenderer.ReactTestRenderer;
async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<BeerWatchesScreen />);
  });
}
const text = () =>
  renderer.root
    .findAllByType(Text)
    .map((n) => [n.props.children].flat().join(''))
    .join('\n');
const hasTestID = (id: string) => renderer.root.findAll((n) => n.props.testID === id).length > 0;

beforeEach(() => {
  jest.clearAllMocks();
  mockState.watches = [];
  mockState.loaded = false;
  mockState.refresh.mockResolvedValue(true);
  jest.mocked(notificationsDenied).mockResolvedValue(false);
});
afterEach(() => act(() => renderer?.unmount()));

it('shows only the error with retry when the first load failed', async () => {
  mockState.refresh.mockResolvedValue(false);
  await mount();
  expect(text()).toContain('Hlídaná piva se nedotáhla.');
  expect(text()).toContain('Zkusit znovu');
  expect(hasTestID('beer-watch-radius')).toBe(false);
  expect(text()).not.toContain('Jak daleko');
  expect(text()).not.toContain('Hlídáš');
});

it('shows the empty state without the radius picker', async () => {
  mockState.loaded = true;
  await mount();
  expect(text()).toContain('Zatím nic nehlídáš.');
  expect(hasTestID('beer-watch-radius')).toBe(false);
});

it('puts the watched list before the radius picker', async () => {
  mockState.loaded = true;
  mockState.watches = [WATCH];
  await mount();
  expect(hasTestID(`beer-watch-row-${WATCH.productKey}`)).toBe(true);
  expect(hasTestID('beer-watch-radius-3000')).toBe(true);
  expect(text().indexOf(WATCH.name)).toBeLessThan(text().indexOf('Jak daleko'));
});

it('warns about notifications only when they are denied', async () => {
  mockState.loaded = true;
  mockState.watches = [WATCH];
  await mount();
  expect(text()).not.toContain('Upozornění máš vypnutá');

  act(() => renderer.unmount());
  jest.mocked(notificationsDenied).mockResolvedValue(true);
  await mount();
  expect(text()).toContain('Upozornění máš vypnutá');
  expect(text()).toContain('Otevřít nastavení');
});
