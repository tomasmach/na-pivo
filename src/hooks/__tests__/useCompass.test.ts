import React from 'react';
import { findRandomPubInRadius, type Pub } from '@/data/pubs';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCompass } from '../useCompass';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@/data/pubs', () => ({
  findNearestPub: jest.fn(),
  findRandomPubInRadius: jest.fn(),
  isLoaded: jest.fn(() => true),
  fetchPubsNear: jest.fn(async () => undefined),
}));

jest.mock('@/compass/useDevicePosition', () => ({
  useDevicePosition: jest.fn(() => ({
    position: {
      lat: 50.08,
      lng: 14.42,
      accuracyMeters: 8,
    },
  })),
}));

jest.mock('@/compass/useDeviceHeading', () => ({
  useDeviceHeading: jest.fn(() => ({
    smoothedHeading: { value: 10 },
    accuracyDeg: 5,
    hasMagnetometer: true,
  })),
}));

jest.mock('react-native-reanimated', () => ({
  useSharedValue: jest.fn((value) => ({ value })),
  useDerivedValue: jest.fn((factory) => ({ value: factory() })),
}));

jest.mock('@/compass/useTargetBearing', () => ({
  useTargetBearing: jest.fn(() => ({
    bearing: 30,
    distanceMeters: 750,
  })),
}));

jest.mock('@/compass/useArrivalDetector', () => ({
  useArrivalDetector: jest.fn(() => ({
    arrived: false,
    dismiss: jest.fn(),
  })),
}));

jest.mock('@/compass/permissions', () => ({
  ensureLocationPermission: jest.fn(async () => 'granted'),
  openSystemSettings: jest.fn(async () => undefined),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function renderCompassHook() {
  let latestResult: ReturnType<typeof useCompass> | undefined;

  function Harness() {
    latestResult = useCompass();
    return null;
  }

  act(() => {
    TestRenderer.create(React.createElement(Harness));
  });

  return {
    get result() {
      if (!latestResult) {
        throw new Error('Hook result was not captured.');
      }
      return latestResult;
    },
  };
}

describe('useCompass', () => {
  const pub: Pub = {
    id: 'osm:far',
    name: 'Far Pub',
    lat: 49.2,
    lng: 16.6,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({
      mode: 'surprise',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      surpriseSeed: 17,
    });
    (findRandomPubInRadius as jest.Mock).mockReturnValue(pub);
  });

  it('keeps surprise mode unlimited when maxDistanceKm is null', async () => {
    const hook = renderCompassHook();

    await act(async () => {
      await Promise.resolve();
    });

    expect(findRandomPubInRadius).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: 50.08,
        lng: 14.42,
        maxKm: undefined,
        seed: 17,
      })
    );
    expect(hook.result.pub).toBe(pub);
  });
});
