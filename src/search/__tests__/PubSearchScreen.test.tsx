import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { searchPubNames, resolvePubSearchResult } from '@/data/pubSearchClient';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import BeerMapScreen from '@/map/BeerMapScreen';
import { saveRecentSearch } from '../recentSearches';
import type { PubSuggestion } from '../pubSuggestions';
import PubSearchScreen from '../PubSearchScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalAnimationFrame = global.requestAnimationFrame;
beforeAll(() => { global.requestAnimationFrame = (callback) => setTimeout(() => callback(0), 0) as unknown as number; });
afterAll(() => { global.requestAnimationFrame = originalAnimationFrame; });
const mockBack = jest.fn();
const mockDismissTo = jest.fn();
const mockPub = { id: 'pub:1', name: 'U Jelena', lat: 49.2, lng: 16.6, city: 'Brno' };
const mockSuggestions: { nearby: PubSuggestion[]; frequent: PubSuggestion[]; pubs: typeof mockPub[] } = { nearby: [], frequent: [], pubs: [] };
jest.mock('../usePubSuggestions', () => ({ usePubSuggestions: () => mockSuggestions }));
jest.mock('react-native', () => ({ ...jest.requireActual('react-native'), BackHandler: { addEventListener: () => ({ remove: jest.fn() }) } }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, dismissTo: mockDismissTo, canGoBack: () => true, replace: jest.fn(), push: jest.fn() }), useFocusEffect: () => undefined }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronRightIcon: () => null, ClockIcon: () => null, SearchIcon: () => null, XIcon: () => null }));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => ({ KeyboardAwareScrollView: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock('@/components/amenities/MapPubSheet', () => ({ MapPubSheet: () => null }));
jest.mock('@/components/amenities/pubInfoContext', () => ({ pubInfoFromPub: (pub: unknown) => pub }));
jest.mock('@/map/BeerMapScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('@/data/hoursClient', () => ({ fetchPubHours: async () => new Map() }));
jest.mock('@/data/pubs', () => ({ hydratePubsSnapshot: async () => true }));
jest.mock('@/data/pubSearchClient', () => ({ localPubSearch: () => [], searchPubNames: jest.fn(), resolvePubSearchResult: jest.fn() }));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: (selector: (s: unknown) => unknown) => selector({ session: null }) }));
jest.mock('@/stores/pubStore', () => ({ usePubStore: (selector: (s: unknown) => unknown) => selector({ reportedPubIds: [], reportedCacheKeys: [] }) }));
jest.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ show: jest.fn() }) } }));
jest.mock('@/utils/maps', () => ({ openPubInMaps: jest.fn(async () => undefined) }));
jest.mock('../recentSearches', () => ({ loadRecentSearches: async () => [], mergeRecentSearches: (_: unknown, term: string) => [term], saveRecentSearch: jest.fn(async () => undefined) }));

let renderer: TestRenderer.ReactTestRenderer;
async function type(value: string) {
  await act(async () => { renderer.root.findByType(TextInput).props.onChangeText(value); });
  await act(async () => { jest.advanceTimersByTime(300); });
}
async function mount() { await act(async () => { renderer = TestRenderer.create(<PubSearchScreen />); }); }
function result() { return renderer.root.findByProps({ accessibilityLabel: 'U Jelena, Brno' }); }

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSuggestions.nearby = [];
  mockSuggestions.frequent = [];
  jest.mocked(searchPubNames).mockResolvedValue({ pubs: [mockPub], failed: false });
  jest.mocked(resolvePubSearchResult).mockResolvedValue(mockPub);
});
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });

it('opens details, preserves the query after closing, and hands the exact pub to the map', async () => {
  await mount(); await type('jelen');
  await act(async () => { result().props.onPress(); });
  expect(renderer.root.findByType(MapPubSheet).props.pubName).toBe('U Jelena');
  act(() => renderer.root.findByType(MapPubSheet).props.onClose());
  expect(renderer.root.findByType(TextInput).props.value).toBe('jelen');
  await act(async () => { result().props.onPress(); });
  act(() => renderer.root.findByType(MapPubSheet).props.onShowMap());
  const map = renderer.root.findByType(BeerMapScreen);
  expect(map.props.initialPub).toEqual(mockPub);
  expect(map.props.focusInitialPub).toBe(true);
  act(() => map.props.onShowCompass());
  expect(mockDismissTo).toHaveBeenCalledWith({ pathname: "/", params: { view: "compass" } });
  act(() => map.props.onSearch());
  expect(renderer.root.findByType(TextInput).props.value).toBe('jelen');
  expect(mockBack).not.toHaveBeenCalled();
});

it('does not overwrite a newer query with a late old response', async () => {
  let old!: (v: { pubs: typeof mockPub[]; failed: boolean }) => void;
  jest.mocked(searchPubNames).mockImplementationOnce(() => new Promise((resolve) => { old = resolve; }));
  await mount(); await type('old'); await type('jelen');
  await act(async () => { old({ pubs: [{ ...mockPub, name: 'Old result' }], failed: false }); });
  expect(result()).toBeTruthy();
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Old result');
});

it('distinguishes failed search from a successful empty response', async () => {
  jest.mocked(searchPubNames).mockResolvedValueOnce({ pubs: [], failed: true });
  await mount(); await type('offline');
  expect(JSON.stringify(renderer.toJSON())).toContain('Hledání teď není dostupné');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Nic jsem nenašel');
  jest.mocked(searchPubNames).mockResolvedValueOnce({ pubs: [], failed: false });
  await type('empty');
  expect(JSON.stringify(renderer.toJSON())).toContain('Nic jsem nenašel');
});

it('ignores a pending place resolution after the user clears the query', async () => {
  let resolve!: (value: typeof mockPub) => void;
  jest.mocked(resolvePubSearchResult).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await mount(); await type('jelen');
  act(() => result().props.onPress());
  await type('');
  await act(async () => resolve(mockPub));
  expect(renderer.root.findAllByType(MapPubSheet)).toHaveLength(0);
});

it('opens a suggested pub without searching or saving an empty recent query', async () => {
  mockSuggestions.nearby = [{ pub: mockPub, distanceMeters: 180 }];
  mockSuggestions.frequent = [{ pub: { ...mockPub, id: 'pub:2', name: 'Stará pošta' }, visitCount: 8 }];
  await mount();
  expect(JSON.stringify(renderer.toJSON())).toContain('V okolí');
  expect(JSON.stringify(renderer.toJSON())).toContain('Tvoje stálice');
  expect(JSON.stringify(renderer.toJSON())).toContain('8 návštěv');
  expect(searchPubNames).not.toHaveBeenCalled();
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'U Jelena, Brno, 180 m' }).props.onPress(); });
  expect(renderer.root.findByType(MapPubSheet).props.pubName).toBe('U Jelena');
  expect(saveRecentSearch).not.toHaveBeenCalled();
  act(() => renderer.root.findByType(MapPubSheet).props.onClose());
  expect(renderer.root.findByType(TextInput).props.value).toBe('');
  expect(JSON.stringify(renderer.toJSON())).toContain('Tvoje stálice');
});

it('replaces suggestions while typing and restores them when clearing', async () => {
  mockSuggestions.frequent = [{ pub: mockPub, visitCount: 3 }];
  await mount();
  await type('jelen');
  expect(JSON.stringify(renderer.toJSON())).not.toContain('Tvoje stálice');
  await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Smazat hledání' }).props.onPress(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Tvoje stálice');
  expect(renderer.root.findByType(TextInput).props.value).toBe('');
});

it('keeps a new user without suggestions on the search field without a loader', async () => {
  await mount();
  const content = JSON.stringify(renderer.toJSON());
  expect(content).not.toContain('Tvoje stálice');
  expect(content).not.toContain('V okolí');
  expect(content).not.toContain('Hledám hospody');
  expect(searchPubNames).not.toHaveBeenCalled();
});
