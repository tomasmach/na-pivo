import React from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useDevicePosition } from '../useDevicePosition';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-location', () => ({
  Accuracy: {
    High: 4,
    BestForNavigation: 6,
  },
  getLastKnownPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

jest.mock('@/location/locationCurrency', () => ({
  updateCurrencyFromCoordinates: jest.fn(),
}));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

type DevicePositionHookProps = {
  enabled: boolean;
};

function renderDevicePositionHook(initialProps: DevicePositionHookProps) {
  let latestResult: ReturnType<typeof useDevicePosition> | undefined;

  function Harness(props: DevicePositionHookProps) {
    latestResult = useDevicePosition(props.enabled);
    return null;
  }

  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };

  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness, initialProps));
  });

  return {
    get result() {
      if (!latestResult) {
        throw new Error('Hook result was not captured.');
      }
      return latestResult;
    },
    rerender(nextProps: DevicePositionHookProps) {
      act(() => {
        renderer.update(React.createElement(Harness, nextProps));
      });
    },
    unmount() {
      act(() => {
        renderer.unmount();
      });
    },
  };
}

describe('useDevicePosition', () => {
  let appStateHandler: ((state: string) => void) | undefined;

  beforeEach(() => {
    appStateHandler = undefined;
    jest.clearAllMocks();
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
    (AppState as { currentState: string }).currentState = 'active';
    (AppState.addEventListener as jest.Mock).mockImplementation((_event, handler) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    });
  });

  it('starts GPS only after watching is enabled', async () => {
    let emitLocation:
      | ((location: { coords: { latitude: number; longitude: number; accuracy: number } }) => void)
      | undefined;

    (Location.watchPositionAsync as jest.Mock).mockImplementation(async (_options, callback) => {
      emitLocation = callback;
      return { remove: jest.fn() };
    });

    const hook = renderDevicePositionHook({ enabled: false });

    await act(async () => {
      await Promise.resolve();
    });

    expect(Location.watchPositionAsync).not.toHaveBeenCalled();

    hook.rerender({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({
      maxAge: 5 * 60 * 1000,
      requiredAccuracy: 100,
    });
    expect(Location.watchPositionAsync).toHaveBeenCalledWith(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 0,
        timeInterval: 1000,
      },
      expect.any(Function),
    );

    act(() => {
      emitLocation?.({
        coords: {
          latitude: 50.087,
          longitude: 14.421,
          accuracy: 12,
        },
      });
    });

    expect(hook.result.position).toEqual({
      lat: 50.087,
      lng: 14.421,
      accuracyMeters: 12,
    });

    hook.unmount();
  });

  it('publishes a recent accurate cached fix before the live watcher emits', async () => {
    let resolveCached:
      | ((location: {
          coords: { latitude: number; longitude: number; accuracy: number };
          timestamp: number;
        }) => void)
      | undefined;
    (Location.getLastKnownPositionAsync as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCached = resolve;
        }),
    );
    (Location.watchPositionAsync as jest.Mock).mockResolvedValue({ remove: jest.fn() });

    const hook = renderDevicePositionHook({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      resolveCached?.({
        coords: { latitude: 50.087, longitude: 14.421, accuracy: 24 },
        timestamp: Date.now(),
      });
      await Promise.resolve();
    });

    expect(hook.result.position).toEqual({
      lat: 50.087,
      lng: 14.421,
      accuracyMeters: 24,
    });
    hook.unmount();
  });

  it('does not let a delayed cached fix overwrite a newer live sample', async () => {
    let emitLocation:
      | ((location: { coords: { latitude: number; longitude: number; accuracy: number } }) => void)
      | undefined;
    let resolveCached:
      | ((location: {
          coords: { latitude: number; longitude: number; accuracy: number };
          timestamp: number;
        }) => void)
      | undefined;
    (Location.getLastKnownPositionAsync as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCached = resolve;
        }),
    );
    (Location.watchPositionAsync as jest.Mock).mockImplementation(async (_options, callback) => {
      emitLocation = callback;
      return { remove: jest.fn() };
    });

    const hook = renderDevicePositionHook({ enabled: true });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitLocation?.({
        coords: { latitude: 49.195, longitude: 16.607, accuracy: 10 },
      });
    });
    await act(async () => {
      resolveCached?.({
        coords: { latitude: 50.087, longitude: 14.421, accuracy: 20 },
        timestamp: Date.now(),
      });
      await Promise.resolve();
    });

    expect(hook.result.position).toEqual({
      lat: 49.195,
      lng: 16.607,
      accuracyMeters: 10,
    });
    hook.unmount();
  });

  it('drops stationary GPS jitter but publishes real movement', async () => {
    let emitLocation:
      | ((location: { coords: { latitude: number; longitude: number; accuracy: number } }) => void)
      | undefined;
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
    (Location.watchPositionAsync as jest.Mock).mockImplementation(async (_options, callback) => {
      emitLocation = callback;
      return { remove: jest.fn() };
    });

    const hook = renderDevicePositionHook({ enabled: true });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitLocation?.({ coords: { latitude: 50.087, longitude: 14.421, accuracy: 12 } });
    });
    const first = hook.result.position;
    expect(first).toEqual({ lat: 50.087, lng: 14.421, accuracyMeters: 12 });

    // ~1 m of jitter with a similar accuracy: same object, no re-render churn.
    act(() => {
      emitLocation?.({ coords: { latitude: 50.087009, longitude: 14.421, accuracy: 13 } });
    });
    expect(hook.result.position).toBe(first);

    // ~110 m of real movement publishes.
    act(() => {
      emitLocation?.({ coords: { latitude: 50.088, longitude: 14.421, accuracy: 12 } });
    });
    expect(hook.result.position).toEqual({ lat: 50.088, lng: 14.421, accuracyMeters: 12 });

    // A large accuracy change publishes even without movement.
    act(() => {
      emitLocation?.({ coords: { latitude: 50.088, longitude: 14.421, accuracy: 40 } });
    });
    expect(hook.result.position).toEqual({ lat: 50.088, lng: 14.421, accuracyMeters: 40 });

    hook.unmount();
  });

  it('does not install a watcher that resolves after the app has backgrounded', async () => {
    let resolveSubscription: ((subscription: { remove: jest.Mock }) => void) | undefined;
    const remove = jest.fn();

    (Location.watchPositionAsync as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubscription = resolve;
        }),
    );

    const hook = renderDevicePositionHook({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    // App backgrounds while the watcher promise is still pending.
    act(() => {
      (AppState as { currentState: string }).currentState = 'background';
      appStateHandler?.('background');
    });

    // The watcher resolves only now — the post-await guard must reject it so no
    // GPS watcher runs in the background.
    await act(async () => {
      resolveSubscription?.({ remove });
      await Promise.resolve();
    });

    expect(remove).toHaveBeenCalledTimes(1);

    hook.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('keeps delivering positions after a StrictMode remount on the same fiber', async () => {
    let emitLocation:
      | ((location: { coords: { latitude: number; longitude: number; accuracy: number } }) => void)
      | undefined;

    (Location.watchPositionAsync as jest.Mock).mockImplementation(async (_options, callback) => {
      emitLocation = callback;
      return { remove: jest.fn() };
    });

    let latestResult: ReturnType<typeof useDevicePosition> | undefined;

    function Harness() {
      latestResult = useDevicePosition(true);
      return null;
    }

    let renderer: { unmount: () => void };
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(React.StrictMode, null, React.createElement(Harness)),
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitLocation?.({
        coords: {
          latitude: 50.087,
          longitude: 14.421,
          accuracy: 12,
        },
      });
    });

    expect(latestResult?.position).toEqual({
      lat: 50.087,
      lng: 14.421,
      accuracyMeters: 12,
    });

    act(() => {
      renderer.unmount();
    });
  });

  it('does not start duplicate GPS watchers while the first subscription is still resolving', async () => {
    let resolveSubscription: ((subscription: { remove: jest.Mock }) => void) | undefined;
    const remove = jest.fn();

    (Location.watchPositionAsync as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubscription = resolve;
        }),
    );

    const hook = renderDevicePositionHook({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });
    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    act(() => {
      appStateHandler?.('active');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(Location.watchPositionAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubscription?.({ remove });
      await Promise.resolve();
    });

    expect(remove).not.toHaveBeenCalled();
    hook.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
