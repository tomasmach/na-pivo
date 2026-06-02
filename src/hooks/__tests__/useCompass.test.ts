import React from 'react';
import { fetchPubsNear, findNearestPub, findRandomPubInRadius, type Pub } from '@/data/pubs';
import { useDevicePosition } from '@/compass/useDevicePosition';
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
const hookCleanups: Array<() => void> = [];

function renderCompassHook() {
  let latestResult: ReturnType<typeof useCompass> | undefined;
  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };

  function Harness() {
    latestResult = useCompass();
    return null;
  }

  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness));
  });

  const hook = {
    get result() {
      if (!latestResult) {
        throw new Error('Hook result was not captured.');
      }
      return latestResult;
    },
    rerender() {
      act(() => {
        renderer.update(React.createElement(Harness));
      });
    },
    unmount() {
      act(() => {
        renderer.unmount();
      });
    },
  };
  hookCleanups.push(hook.unmount);
  return hook;
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
    (useDevicePosition as jest.Mock).mockReturnValue({
      position: {
        lat: 50.08,
        lng: 14.42,
        accuracyMeters: 8,
      },
    });
    useSettingsStore.setState({
      mode: 'surprise',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      surpriseSeed: 17,
    });
    (findNearestPub as jest.Mock).mockReturnValue(pub);
    (findRandomPubInRadius as jest.Mock).mockReturnValue(pub);
  });

  afterEach(() => {
    for (const cleanup of hookCleanups.splice(0)) {
      cleanup();
    }
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

  it('keeps a revealed pub visible through location jitter within reported accuracy', async () => {
    const nearbyPub: Pub = {
      id: 'osm:nearby',
      name: 'Nearby Pub',
      lat: 50.08,
      lng: 14.42,
    };
    const jitterPub: Pub = {
      id: 'osm:jitter',
      name: 'Jitter Pub',
      lat: 50.081,
      lng: 14.42,
    };

    useSettingsStore.setState({
      mode: 'nearest',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      surpriseSeed: 17,
    });
    (findNearestPub as jest.Mock).mockReturnValue(nearbyPub);
    (useDevicePosition as jest.Mock).mockReturnValue({
      position: {
        lat: 50.08,
        lng: 14.42,
        accuracyMeters: 200,
      },
    });

    const hook = renderCompassHook();

    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.result.pub).toBe(nearbyPub);

    act(() => {
      hook.result.reveal();
    });

    expect(hook.result.revealed).toBe(true);

    const callsBeforeJitter = (findNearestPub as jest.Mock).mock.calls.length;
    (findNearestPub as jest.Mock).mockReturnValue(jitterPub);

    (useDevicePosition as jest.Mock).mockReturnValue({
      position: {
        lat: 50.0809,
        lng: 14.42,
        accuracyMeters: 200,
      },
    });

    hook.rerender();

    await act(async () => {
      await Promise.resolve();
    });

    expect((findNearestPub as jest.Mock).mock.calls).toHaveLength(callsBeforeJitter);
    expect(hook.result.pub).toBe(nearbyPub);
    expect(hook.result.revealed).toBe(true);
  });

  it('forces a fresh pub fetch when retrying search', async () => {
    const hook = renderCompassHook();

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      hook.result.retrySearch();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchPubsNear).toHaveBeenLastCalledWith(50.08, 14.42, undefined, { force: true });
  });
});
