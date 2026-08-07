import React from 'react';
import { fetchPubsNear, findNearestPub, findRandomPubInRadius, type Pub } from '@/data/pubs';
import { useDevicePosition } from '@/compass/useDevicePosition';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCompass } from '../useCompass';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The compass focus-gates its sensors via expo-router's useFocusEffect; under
// test the screen is treated as focused, so the effect runs on mount (and its
// cleanup on unmount) exactly like a focused tab.
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useFocusEffect: (cb: () => void | (() => void)) => {
      useEffect(() => cb(), [cb]);
    },
  };
});

jest.mock('@/data/pubs', () => ({
  findNearestPub: jest.fn(),
  findRandomPubInRadius: jest.fn(),
  isLoaded: jest.fn(() => true),
  fetchPubsNear: jest.fn(async () => undefined),
}));

jest.mock('@/data/pubReportsClient', () => ({
  reportPubIssue: jest.fn(async () => true),
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
  checkLocationPermission: jest.fn(async () => 'granted'),
  ensureLocationPermission: jest.fn(async () => 'granted'),
  openSystemSettings: jest.fn(async () => undefined),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const hookCleanups: Array<() => void> = [];

function renderCompassHook() {
  let latestResult: ReturnType<typeof useCompass> | undefined;
  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };
  const loadingLog: boolean[] = [];
  let filters: { beerBrandFilter: string | readonly string[] | null; amenityKeys: string[] } = {
    beerBrandFilter: null,
    amenityKeys: [],
  };

  function Harness() {
    const result = useCompass(filters.beerBrandFilter, filters.amenityKeys);
    loadingLog.push(result.isLoading);
    latestResult = result;
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
    loadingLog,
    rerender() {
      act(() => {
        renderer.update(React.createElement(Harness));
      });
    },
    setFilters(next: {
      beerBrandKey?: string | null;
      beerBrandKeys?: readonly string[];
      amenityKeys?: string[];
    }) {
      filters = {
        beerBrandFilter:
          next.beerBrandKeys !== undefined ? next.beerBrandKeys : (next.beerBrandKey ?? null),
        amenityKeys: next.amenityKeys ?? [],
      };
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
      hideClosedPubs: true,
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
      hideClosedPubs: true,
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

  it('does not flash the loading screen when switching modes', async () => {
    const nearestPub: Pub = { id: 'osm:nearest', name: 'Nearest Pub', lat: 50.08, lng: 14.42 };
    const surprisePub: Pub = { id: 'osm:surprise', name: 'Surprise Pub', lat: 49.2, lng: 16.6 };

    useSettingsStore.setState({
      mode: 'nearest',
      maxDistanceKm: null,
      hapticEnabled: true,
      soundEnabled: false,
      hideClosedPubs: true,
      surpriseSeed: 17,
    });
    (findNearestPub as jest.Mock).mockReturnValue(nearestPub);
    (findRandomPubInRadius as jest.Mock).mockReturnValue(surprisePub);

    const hook = renderCompassHook();

    await act(async () => {
      await Promise.resolve();
    });

    // Initial load settled: a real pub is shown, no loading state.
    expect(hook.result.isLoading).toBe(false);
    expect(hook.result.pub).toBe(nearestPub);

    // Switch to surprise mode and capture every render that happens in between.
    const rendersBeforeSwitch = hook.loadingLog.length;

    act(() => {
      hook.result.setMode('surprise');
    });

    await act(async () => {
      await Promise.resolve();
    });

    const rendersDuringSwitch = hook.loadingLog.slice(rendersBeforeSwitch);

    // The active compass must never blink to the full-screen loading state while
    // re-selecting the target — the recompute is synchronous and local.
    expect(rendersDuringSwitch).not.toContain(true);
    expect(hook.result.isLoading).toBe(false);
    expect(hook.result.pub).toBe(surprisePub);
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

    expect(fetchPubsNear).toHaveBeenLastCalledWith(50.08, 14.42, undefined, {
      beerBrandKey: null,
      amenityKeys: [],
      force: true,
      includeOtherPlaces: false,
      radiusKm: 100,
    });
  });

  it('surfaces pub search failures separately from an empty result', async () => {
    (fetchPubsNear as jest.Mock).mockRejectedValueOnce(new Error('HTTP 403'));

    const hook = renderCompassHook();

    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.result.searchFailed).toBe(true);
  });

  it('hides the previous pub while a new hard filter is pending', async () => {
    const hook = renderCompassHook();
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.pub).toBe(pub);

    let resolveFiltered!: () => void;
    (fetchPubsNear as jest.Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFiltered = resolve;
      }),
    );

    hook.setFilters({ amenityKeys: ['payment_card'] });

    expect(hook.result.isLoading).toBe(true);
    expect(hook.result.pub).toBeNull();
    for (const lat of [50.09, 50.1, 50.11]) {
      (useDevicePosition as jest.Mock).mockReturnValue({
        position: { lat, lng: 14.42, accuracyMeters: 8 },
      });
      hook.rerender();
    }
    // Initial unfiltered lookup + exactly one filtered lookup. GPS jitter while
    // the hard-filter request is pending must not enqueue duplicates.
    expect(fetchPubsNear).toHaveBeenCalledTimes(2);
    expect(hook.result.pub).toBeNull();

    await act(async () => {
      resolveFiltered();
      await Promise.resolve();
    });

    expect(hook.result.isLoading).toBe(false);
    expect(hook.result.pub).toBe(pub);
  });

  it('refetches with stable multi-brand keys and canonical amenity keys', async () => {
    const hook = renderCompassHook();
    await act(async () => {
      await Promise.resolve();
    });

    hook.setFilters({
      beerBrandKeys: ['radegast', 'pilsner-urquell', 'radegast'],
      amenityKeys: ['seating_garden', 'practical_tank_beer'],
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchPubsNear).toHaveBeenLastCalledWith(50.08, 14.42, undefined, {
      beerBrandKeys: ['pilsner-urquell', 'radegast'],
      amenityKeys: ['practical_tank_beer', 'seating_garden'],
      force: true,
      includeOtherPlaces: false,
      radiusKm: 100,
    });
  });

  describe('radius-change debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    // Flush the microtask queue inside act so the mocked fetch's resolved
    // .then() state updates settle without "not wrapped in act" warnings.
    const flush = () => act(async () => { await Promise.resolve(); });

    it('does NOT delay the first fetch on mount', async () => {
      renderCompassHook();
      await flush();
      // The initial mount fetch must fire synchronously, with no timer pending.
      expect(fetchPubsNear).toHaveBeenCalledTimes(1);
    });

    it('coalesces rapid maxDistanceKm changes into a single fetch', async () => {
      renderCompassHook();
      await flush();
      // Mount fetch (immediate).
      expect(fetchPubsNear).toHaveBeenCalledTimes(1);

      // Simulate dragging the distance slider upward: several rapid changes.
      act(() => {
        useSettingsStore.setState({ maxDistanceKm: 5 });
      });
      act(() => {
        useSettingsStore.setState({ maxDistanceKm: 10 });
      });
      act(() => {
        useSettingsStore.setState({ maxDistanceKm: 20 });
      });

      // Nothing fired yet — the radius-change path is debounced.
      expect(fetchPubsNear).toHaveBeenCalledTimes(1);

      act(() => {
        jest.advanceTimersByTime(700);
      });
      await flush();

      // Exactly one extra fetch for the whole drag, with the final radius.
      expect(fetchPubsNear).toHaveBeenCalledTimes(2);
      expect(fetchPubsNear).toHaveBeenLastCalledWith(50.08, 14.42, undefined, {
        beerBrandKey: null,
        amenityKeys: [],
        force: false,
        includeOtherPlaces: false,
        radiusKm: 20,
      });
    });

    it('fires a GPS-driven fetch immediately (not debounced)', async () => {
      const hook = renderCompassHook();
      await flush();
      expect(fetchPubsNear).toHaveBeenCalledTimes(1);

      // A position change (radius unchanged) must not be delayed.
      (useDevicePosition as jest.Mock).mockReturnValue({
        position: { lat: 51.0, lng: 15.0, accuracyMeters: 8 },
      });
      act(() => {
        hook.rerender();
      });
      await flush();

      expect(fetchPubsNear).toHaveBeenCalledTimes(2);
      expect(fetchPubsNear).toHaveBeenLastCalledWith(51.0, 15.0, undefined, {
        beerBrandKey: null,
        amenityKeys: [],
        force: false,
        includeOtherPlaces: false,
        radiusKm: 100,
      });
    });
  });
});
