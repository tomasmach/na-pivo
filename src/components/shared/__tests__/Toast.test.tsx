import React from 'react';

import { Toast } from '@/components/shared/Toast';
import { useToastStore } from '@/stores/toastStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanHandlers = {
  onStart?: () => void;
  onUpdate?: (event: { translationY: number }) => void;
  onEnd?: (event: { translationY: number; velocityY: number }) => void;
};
const pan: PanHandlers = {};

jest.mock('react-native-gesture-handler', () => {
  const chain = {
    activeOffsetY: () => chain,
    onStart: (fn: PanHandlers['onStart']) => ((pan.onStart = fn), chain),
    onUpdate: (fn: PanHandlers['onUpdate']) => ((pan.onUpdate = fn), chain),
    onEnd: (fn: PanHandlers['onEnd']) => ((pan.onEnd = fn), chain),
  };
  return {
    Gesture: { Pan: () => chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement('AnimatedView', props, children),
    },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withSpring: (value: number) => value,
    // Finish at once so the callback (dismiss / flick away) runs like it would on device.
    withTiming: (value: number, _config: unknown, done?: (finished: boolean) => void) => {
      done?.(true);
      return value;
    },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  };
});
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => false }));
jest.mock('@/components/shared/IconGlyph', () => ({ BeerIcon: () => null, ChevronRightIcon: () => null }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function mount() {
  let renderer: { unmount: () => void } | undefined;
  act(() => {
    renderer = TestRenderer.create(<Toast />);
  });
  return renderer!;
}

describe('Toast flick and hold', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    act(() => useToastStore.getState().hide());
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('goes away on a flick up long before it would time out', () => {
    const renderer = mount();
    act(() => useToastStore.getState().show('Čárka na tácku přibyla.'));

    act(() => {
      pan.onStart?.();
      pan.onUpdate?.({ translationY: -40 });
      pan.onEnd?.({ translationY: -40, velocityY: -200 });
    });

    expect(useToastStore.getState().message).toBeNull();
    act(() => renderer.unmount());
  });

  it('stays up while held and times out again once let go', () => {
    const renderer = mount();
    act(() => useToastStore.getState().show('Čárka na tácku přibyla.'));

    act(() => pan.onStart?.());
    act(() => jest.advanceTimersByTime(10_000));
    expect(useToastStore.getState().message).toBe('Čárka na tácku přibyla.');

    act(() => pan.onEnd?.({ translationY: 4, velocityY: 0 }));
    expect(useToastStore.getState().message).toBe('Čárka na tácku přibyla.');
    act(() => jest.advanceTimersByTime(2_400));
    expect(useToastStore.getState().message).toBeNull();
    act(() => renderer.unmount());
  });

  it('does not carry a hold over to the next toast', () => {
    const renderer = mount();
    act(() => useToastStore.getState().show('První'));
    act(() => pan.onStart?.());
    act(() => useToastStore.getState().show('Druhý'));

    act(() => jest.advanceTimersByTime(2_400));
    expect(useToastStore.getState().message).toBeNull();
    act(() => renderer.unmount());
  });
});
