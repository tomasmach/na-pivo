import React from 'react';
import * as Location from 'expo-location';

import { ensureLocationPermission } from '@/compass/permissions';
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
  getCurrentPositionAsync: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

describe('HomePointScreen', () => {
  let renderer: any;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
