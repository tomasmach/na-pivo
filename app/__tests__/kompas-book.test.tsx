import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, useWindowDimensions } from 'react-native';

import { t } from '@/i18n';
import { geohash8 } from '@/data/geohash';
import { useSettingsStore } from '@/stores/settingsStore';
import { CompassCard } from '@/compassui/CompassCard';
import BeerMapScreen from '@/map/BeerMapScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    KeyboardAvoidingView: jest.fn(({ children }) => <RN.View>{children}</RN.View>),
    Modal: jest.fn(({ children, visible }) => (visible ? <RN.View>{children}</RN.View> : null)),
    TextInput: jest.fn(() => null),
  };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
  useRouter: jest.fn(() => ({ push: jest.fn() })),
}));
// The right-half pages have their own tests and pull in every detail screen.
jest.mock('@/layout/RightPage', () => ({ RightPage: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaInsetsContext: jest.requireActual<typeof import('react')>('react').createContext(null),
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('react-native-reanimated', () => ({
  useAnimatedReaction: jest.fn(),
  useSharedValue: jest.fn((value) => ({ value })),
}));
jest.mock('@/components/compass/CompassContainer', () => ({ CompassContainer: jest.fn(() => null) }));
jest.mock('@/components/compass/PubFilterSheet', () => ({ PubFilterSheet: jest.fn(() => null) }));
jest.mock('@/components/compass/ReportPubModal', () => ({ ReportPubModal: jest.fn(() => null) }));
jest.mock('@/components/compass/RenamePubModal', () => ({ RenamePubModal: jest.fn(() => null) }));
jest.mock('@/compassui/CompassCard', () => ({ CompassCard: jest.fn(() => null) }));
jest.mock('@/components/shared/MoreSheet', () => ({ MoreSheet: jest.fn(() => null) }));
jest.mock('@/counter/NudgeSlot', () => ({ NudgeSlot: jest.fn(() => null) }));
jest.mock('@/counter/CounterCta', () => ({
  CounterCta: jest.fn(() => null),
  CounterSecondary: jest.fn(() => null),
}));
jest.mock('@/map/BeerMapScreen', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('@/components/shared/GlowButton', () => ({ GlowButton: jest.fn(() => null) }));
jest.mock('@/components/shared/IconGlyph', () => new Proxy({}, { get: () => () => null }));
jest.mock('@/search/PubSearchButton', () => ({ PubSearchButton: jest.fn(() => null) }));
jest.mock('@/utils/maps', () => ({ openPubInMaps: jest.fn(), openHomeInMaps: jest.fn() }));
jest.mock('@/hooks/useCompass', () => ({ useCompass: jest.fn() }));
jest.mock('@/data/account', () => ({ updateAccountPreferences: jest.fn(async () => null) }));

const CompassTab = require('../(tabs)/index').default;
const { useCompass } = require('@/hooks/useCompass') as { useCompass: jest.Mock };
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const CompassCardMock = CompassCard as unknown as jest.Mock;
const BeerMapScreenMock = BeerMapScreen as unknown as jest.Mock;
const windowSize = useWindowDimensions as jest.Mock;

const PUB = { id: 'osm:1', name: 'U Zlatého tygra', lat: 50.0868, lng: 14.4196 };

function compassState(overrides: Record<string, unknown> = {}) {
  return {
    arrowRotation: { value: null },
    distanceFormatted: '80 m',
    pub: PUB,
    revealed: false,
    reveal: jest.fn(),
    mode: 'nearest',
    setMode: jest.fn(),
    reroll: jest.fn(),
    skip: jest.fn(),
    reportCurrentPub: jest.fn(async () => true),
    renameCurrentPub: jest.fn(async () => true),
    retrySearch: jest.fn(),
    arrived: false,
    dismissArrival: jest.fn(),
    headingAccuracy: null,
    hasMagnetometer: true,
    permissionState: 'granted',
    requestPermission: jest.fn(),
    isLoading: false,
    searchFailed: false,
    currentPosition: null,
    focusedPub: null,
    clearFocusedPub: jest.fn(),
    ...overrides,
  };
}

function setWindow(width: number, height: number) {
  windowSize.mockReturnValue({ width, height, scale: 3, fontScale: 1 });
}

function render() {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(<CompassTab />);
  });
  return renderer;
}

const lastProps = (mock: jest.Mock) => mock.mock.calls.at(-1)?.[0];
const mounted = (renderer: any, type: unknown) => renderer.root.findAllByType(type).length > 0;
/** Host elements only: the test renderer also lists the composite that passes the label down. */
const labelled = (renderer: any, label: string) =>
  renderer.root.findAll((node: any) => typeof node.type === 'string' && node.props.accessibilityLabel === label)
    .length;

describe('Kompas on the open iPhone Duo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), setParams: jest.fn() });
    act(() => {
      useSettingsStore.setState({ hidePubNames: false, homePoint: null, mapWithoutLocation: false });
    });
    useCompass.mockReturnValue(compassState());
  });

  afterAll(() => setWindow(390, 844));

  it.each([
    ['on its side', 951, 669],
    ['upright on a table', 669, 951],
  ])('shows the compass and the map at once %s, without the switch', (_pose, width, height) => {
    setWindow(width, height);
    const renderer = render();
    expect(mounted(renderer, CompassCardMock)).toBe(true);
    expect(mounted(renderer, BeerMapScreenMock)).toBe(true);
    expect(labelled(renderer, t.a11y.mapSwitchToMap)).toBe(0);
    expect(JSON.stringify(renderer.toJSON())).toContain(t.map.compass);
    // The compass keeps listening to the sensors while the map is beside it.
    expect(useCompass.mock.calls.at(-1)?.[4]).toBe(true);
  });

  it('lays the compass card sideways on a table and upright on its side', () => {
    setWindow(669, 951);
    render();
    expect(lastProps(CompassCardMock).sideways).toBe(true);
    setWindow(951, 669);
    render();
    expect(lastProps(CompassCardMock).sideways).toBe(false);
  });

  it('marks the compass target on the map', () => {
    setWindow(951, 669);
    render();
    expect(lastProps(BeerMapScreenMock)).toMatchObject({
      initialPub: PUB,
      highlightPubKey: geohash8(PUB.lat, PUB.lng),
    });
  });

  it('keeps a hidden target secret on the map', () => {
    act(() => {
      useSettingsStore.setState({ hidePubNames: true });
    });
    setWindow(951, 669);
    render();
    expect(lastProps(CompassCardMock).hidden).toBe(true);
    expect(lastProps(BeerMapScreenMock)).toMatchObject({ initialPub: null, highlightPubKey: null });
  });

  it('asks for location on the left and shows the map on the right without the map door', () => {
    useCompass.mockReturnValue(compassState({ permissionState: 'denied' }));
    setWindow(951, 669);
    const renderer = render();
    expect(JSON.stringify(renderer.toJSON())).toContain(t.permissions.title);
    expect(labelled(renderer, t.map.openWithoutLocation)).toBe(0);
    expect(mounted(renderer, BeerMapScreenMock)).toBe(true);
  });

  it('lands on the compass, not the map, when the phone folds', () => {
    act(() => {
      useSettingsStore.setState({ mapWithoutLocation: true });
    });
    useCompass.mockReturnValue(compassState({ permissionState: 'denied' }));
    setWindow(951, 669);
    const renderer = render();
    expect(mounted(renderer, BeerMapScreenMock)).toBe(true);

    setWindow(466, 678);
    act(() => renderer.update(<CompassTab />));
    expect(mounted(renderer, BeerMapScreenMock)).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain(t.permissions.title);
    // The phone gets its door to the map back.
    expect(labelled(renderer, t.map.openWithoutLocation)).toBe(1);
  });

  it('keeps the phone exactly as it was: compass or map, never both', () => {
    setWindow(402, 874);
    const renderer = render();
    expect(mounted(renderer, CompassCardMock)).toBe(true);
    expect(mounted(renderer, BeerMapScreenMock)).toBe(false);
    expect(labelled(renderer, t.a11y.mapSwitchToMap)).toBe(1);

    act(() => renderer.root.findAllByProps({ accessibilityLabel: t.a11y.mapSwitchToMap })[0].props.onPress());
    expect(mounted(renderer, BeerMapScreenMock)).toBe(true);
    expect(mounted(renderer, CompassCardMock)).toBe(false);
    expect(lastProps(BeerMapScreenMock)).toMatchObject({ initialPub: PUB, highlightPubKey: null });
  });
});
