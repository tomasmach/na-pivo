import React from 'react';
import * as Location from 'expo-location';

import { ensureLocationPermission } from '@/compass/permissions';
import { geocodePubLocation } from '@/data/mapyClient';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import HomePointScreen from '../home-point';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
  MapPinIcon: () => null,
  TargetIcon: () => null,
  Trash2Icon: () => null,
}));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => {
  const RN = jest.requireActual('react-native');
  return {
    KeyboardAwareScrollView: ({ children, ...props }: { children: React.ReactNode }) => (
      <RN.ScrollView {...props} testID="keyboard-aware-scroll-view">
        {children}
      </RN.ScrollView>
    ),
  };
});
jest.mock('@/data/mapyClient', () => ({
  geocodePubLocation: jest.fn(),
}));
jest.mock('react-native-maps', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => <RN.View {...props} testID="home-map" />,
    Marker: () => null,
  };
});
jest.mock('@/compass/permissions', () => ({
  ensureLocationPermission: jest.fn(),
  openSystemSettings: jest.fn(),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  geocodeAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

describe('HomePointScreen', () => {
  let renderer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(Location.geocodeAsync).mockResolvedValue([]);
    useSettingsStore.setState({ homePoint: null });
  });

  afterEach(() => {
    if (!renderer) return;
    act(() => renderer.unmount());
    renderer = undefined;
  });

  it('persists a manually selected point only after explicit confirmation', () => {
    act(() => {
      renderer = TestRenderer.create(<HomePointScreen />);
    });

    const map = renderer.root.findByProps({ testID: 'home-map' });
    act(() => {
      map.props.onPress({ nativeEvent: { coordinate: { latitude: 50.08, longitude: 14.42 } } });
    });
    expect(useSettingsStore.getState().homePoint).toBeNull();

    const save = renderer.root.findByProps({ children: 'Uložit domov' }).parent;
    act(() => save.props.onPress());
    expect(useSettingsStore.getState().homePoint).toEqual({ lat: 50.08, lng: 14.42 });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('finds an entered address, lets the user refine it, and saves only the confirmed point', async () => {
    jest.mocked(geocodePubLocation).mockResolvedValue({
      lat: 50.075,
      lng: 14.44,
      type: 'regional.address',
    });
    act(() => {
      renderer = TestRenderer.create(<HomePointScreen />);
    });

    expect(renderer.root.findByProps({ testID: 'keyboard-aware-scroll-view' })).toBeTruthy();
    const input = renderer.root.findByProps({
      accessibilityLabel: 'Adresa nebo město domovského bodu',
    });
    act(() => input.props.onChangeText('Vinohradská 12, Praha'));

    const find = renderer.root.findByProps({ accessibilityLabel: 'Najít adresu na mapě' });
    await act(async () => {
      await find.props.onPress();
    });

    expect(geocodePubLocation).toHaveBeenCalledWith(
      { name: '', address: 'Vinohradská 12, Praha' },
      expect.any(AbortSignal),
    );
    const map = renderer.root.findByProps({ testID: 'home-map' });
    expect(map.props.region).toEqual({
      latitude: 50.075,
      longitude: 14.44,
      latitudeDelta: 0.025,
      longitudeDelta: 0.025,
    });

    act(() => {
      map.props.onPress({ nativeEvent: { coordinate: { latitude: 50.076, longitude: 14.441 } } });
    });
    const save = renderer.root.findByProps({ children: 'Uložit domov' }).parent;
    act(() => save.props.onPress());

    expect(useSettingsStore.getState().homePoint).toEqual({ lat: 50.076, lng: 14.441 });
  });

  it('uses the native address geocoder before the backend fallback', async () => {
    jest.mocked(Location.geocodeAsync).mockResolvedValue([
      { latitude: 50.083, longitude: 14.426, accuracy: 10, altitude: 0 },
    ]);
    act(() => {
      renderer = TestRenderer.create(<HomePointScreen />);
    });

    const input = renderer.root.findByProps({
      accessibilityLabel: 'Adresa nebo město domovského bodu',
    });
    act(() => input.props.onChangeText('Václavské náměstí 1, Praha'));
    const find = renderer.root.findByProps({ accessibilityLabel: 'Najít adresu na mapě' });
    await act(async () => {
      await find.props.onPress();
    });

    expect(Location.geocodeAsync).toHaveBeenCalledWith('Václavské náměstí 1, Praha');
    expect(geocodePubLocation).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: 'home-map' }).props.region).toEqual({
      latitude: 50.083,
      longitude: 14.426,
      latitudeDelta: 0.025,
      longitudeDelta: 0.025,
    });
  });

  it('explains the one-time address lookup and local-only point storage', () => {
    act(() => {
      renderer = TestRenderer.create(<HomePointScreen />);
    });

    expect(
      renderer.root.findByProps({
        children:
          'Zadaná adresa se jednorázově odešle geokódovací službě. Aplikace lokálně uloží jen finální potvrzený bod. Žádnou historii polohy ani trasy neukládá.',
      }),
    ).toBeTruthy();
  });

  it('keeps manual selection available when location permission is denied', async () => {
    jest.mocked(ensureLocationPermission).mockResolvedValue('denied');
    jest.mocked(Location.getCurrentPositionAsync).mockClear();
    await act(async () => {
      renderer = TestRenderer.create(<HomePointScreen />);
    });

    const locate = renderer.root.findByProps({ children: 'Použít moji polohu' }).parent;
    await act(async () => {
      await locate.props.onPress();
    });

    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(
      renderer.root.findAll(
        (node: { props: { children?: unknown } }) =>
          typeof node.props.children === 'string' && node.props.children.includes('vybrat ručně'),
      ),
    ).not.toHaveLength(0);
    expect(useSettingsStore.getState().homePoint).toBeNull();
  });

  it('shows a useful error when the current location provider fails', async () => {
    jest.mocked(ensureLocationPermission).mockResolvedValue('granted');
    jest.mocked(Location.getCurrentPositionAsync).mockRejectedValue(new Error('GPS unavailable'));
    act(() => {
      renderer = TestRenderer.create(<HomePointScreen />);
    });

    const locate = renderer.root.findByProps({ children: 'Použít moji polohu' }).parent;
    await act(async () => {
      await locate.props.onPress();
    });

    expect(
      renderer.root.findByProps({ children: cs.addPub.locationUnavailable }),
    ).toBeTruthy();
    expect(useSettingsStore.getState().homePoint).toBeNull();
  });
});
