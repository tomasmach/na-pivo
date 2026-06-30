import React from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useDeviceHeading } from '../useDeviceHeading';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-location', () => ({
  watchHeadingAsync: jest.fn(),
}));

jest.mock('react-native-reanimated', () => ({
  useSharedValue: (value: unknown) => ({ value }),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

type DeviceHeadingHookProps = {
  enabled: boolean;
};

function renderDeviceHeadingHook(initialProps: DeviceHeadingHookProps) {
  let latestResult: ReturnType<typeof useDeviceHeading> | undefined;

  function Harness(props: DeviceHeadingHookProps) {
    latestResult = useDeviceHeading(props.enabled);
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
    rerender(nextProps: DeviceHeadingHookProps) {
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

describe('useDeviceHeading', () => {
  let appStateHandler: ((state: string) => void) | undefined;

  beforeEach(() => {
    appStateHandler = undefined;
    jest.clearAllMocks();
    (AppState as { currentState: string }).currentState = 'active';
    (AppState.addEventListener as jest.Mock).mockImplementation((_event, handler) => {
      appStateHandler = handler;
      return { remove: jest.fn() };
    });
  });

  it('does not start duplicate heading watchers while the first subscription is still resolving', async () => {
    let resolveSubscription: ((subscription: { remove: jest.Mock }) => void) | undefined;
    const remove = jest.fn();

    (Location.watchHeadingAsync as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubscription = resolve;
        }),
    );

    const hook = renderDeviceHeadingHook({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });
    expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(1);

    act(() => {
      appStateHandler?.('active');
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(Location.watchHeadingAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSubscription?.({ remove });
      await Promise.resolve();
    });

    expect(remove).not.toHaveBeenCalled();
    expect(hook.result.hasMagnetometer).toBe(true);

    hook.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
