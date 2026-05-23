import React from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useDevicePosition } from '../useDevicePosition';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-location', () => ({
  Accuracy: {
    Balanced: 3,
  },
  watchPositionAsync: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
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
  beforeEach(() => {
    jest.clearAllMocks();
    (AppState as { currentState: string }).currentState = 'active';
    (AppState.addEventListener as jest.Mock).mockReturnValue({ remove: jest.fn() });
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
});
