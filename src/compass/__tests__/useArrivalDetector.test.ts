import React from 'react';
import { useArrivalDetector, type UseArrivalDetectorOptions } from '../useArrivalDetector';
import { fireSuccessHaptic } from '@/utils/haptics';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    remove: jest.fn(),
  })),
}));

jest.mock('@/utils/haptics', () => ({
  fireSuccessHaptic: jest.fn(),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderArrivalDetector(initialProps: UseArrivalDetectorOptions) {
  let props = initialProps;
  let latestResult: ReturnType<typeof useArrivalDetector> | undefined;
  let renderer: { update: (element: React.ReactElement) => void; unmount: () => void };

  function Harness() {
    latestResult = useArrivalDetector(props);
    return null;
  }

  act(() => {
    renderer = TestRenderer.create(React.createElement(Harness));
  });

  return {
    get result() {
      if (!latestResult) {
        throw new Error('Hook result was not captured.');
      }
      return latestResult;
    },
    update(nextProps: Partial<UseArrivalDetectorOptions>) {
      props = { ...props, ...nextProps };
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
}

describe('useArrivalDetector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fire on cold start when already inside the arrival radius', async () => {
    const hook = renderArrivalDetector({
      distanceMeters: 0,
      gpsAccuracyMeters: 5,
      targetPubId: 'pub-1',
      hapticEnabled: true,
      soundEnabled: false,
    });
    await flushEffects();

    expect(hook.result.arrived).toBe(false);
    expect(fireSuccessHaptic).not.toHaveBeenCalled();

    hook.unmount();
  });

  it('fires after crossing from outside to inside the arrival radius', async () => {
    const hook = renderArrivalDetector({
      distanceMeters: 80,
      gpsAccuracyMeters: 5,
      targetPubId: 'pub-1',
      hapticEnabled: true,
      soundEnabled: false,
    });
    await flushEffects();

    expect(hook.result.arrived).toBe(false);

    hook.update({ distanceMeters: 20 });
    await flushEffects();

    expect(hook.result.arrived).toBe(true);
    expect(fireSuccessHaptic).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  it('does not refire for the same pub after dismiss while still inside', async () => {
    const hook = renderArrivalDetector({
      distanceMeters: 80,
      gpsAccuracyMeters: 5,
      targetPubId: 'pub-1',
      hapticEnabled: true,
      soundEnabled: false,
    });
    await flushEffects();

    hook.update({ distanceMeters: 20 });
    await flushEffects();
    expect(hook.result.arrived).toBe(true);

    act(() => {
      hook.result.dismiss();
    });
    hook.update({ distanceMeters: 10 });
    await flushEffects();

    expect(hook.result.arrived).toBe(false);
    expect(fireSuccessHaptic).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  it('arms after leaving when the first sample started inside', async () => {
    const hook = renderArrivalDetector({
      distanceMeters: 0,
      gpsAccuracyMeters: 5,
      targetPubId: 'pub-1',
      hapticEnabled: true,
      soundEnabled: false,
    });
    await flushEffects();

    hook.update({ distanceMeters: 80 });
    await flushEffects();
    hook.update({ distanceMeters: 20 });
    await flushEffects();

    expect(hook.result.arrived).toBe(true);
    expect(fireSuccessHaptic).toHaveBeenCalledTimes(1);

    hook.unmount();
  });
});
