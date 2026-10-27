import React from 'react';
import { Text, View } from 'react-native';
import { GestureStateManager } from 'react-native-gesture-handler';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { BottomSheetScrollView } from '@/components/shared/BottomSheetScrollView';
import { fireSoftImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Animations finish only when a test says so, so it can look at the sheet mid-motion.
const finishing: (() => void)[] = [];
function finishAnimations() {
  while (finishing.length) finishing.shift()!();
}

jest.mock('react-native-reanimated', () => {
  const settle = (value: number, callback?: (finished: boolean) => void) => {
    if (callback) finishing.push(() => callback(true));
    return value;
  };
  return {
    __esModule: true,
    default: { View: 'AnimatedView' },
    useSharedValue: (initial: number) => {
      const ref = jest.requireActual('react').useRef(null);
      if (!ref.current) {
        const shared = {
          value: initial,
          get: () => shared.value,
          set: (next: number) => {
            shared.value = next;
          },
        };
        ref.current = shared;
      }
      return ref.current;
    },
    useAnimatedStyle: (factory: () => object) => factory(),
    useReducedMotion: jest.fn(() => false),
    withSpring: jest.fn((value: number, _config: object, callback?: (finished: boolean) => void) => settle(value, callback)),
    withTiming: jest.fn((value: number, _config: object, callback?: (finished: boolean) => void) => settle(value, callback)),
    cancelAnimation: jest.fn(),
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    Easing: { in: (easing: unknown) => easing, cubic: 'cubic' },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@/utils/haptics', () => ({ fireSoftImpactHaptic: jest.fn() }));

const { useReducedMotion, withSpring } = jest.requireMock('react-native-reanimated') as {
  useReducedMotion: jest.Mock;
  withSpring: jest.Mock;
};

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const SHEET_HEIGHT = 800;
const CARD_TOP = 400;
const TRAVEL = SHEET_HEIGHT - CARD_TOP;

interface Props {
  visible: boolean;
  onClose?: () => void;
  onClosed?: () => void;
  scroll?: boolean;
}

function sheet({ visible, onClose = jest.fn(), onClosed, scroll = false }: Props) {
  return (
    <BottomSheetModal visible={visible} onClose={onClose} onClosed={onClosed}>
      <View testID="card">
        <Text>Tvůj účet</Text>
        {scroll ? <BottomSheetScrollView testID="list" /> : null}
      </View>
    </BottomSheetModal>
  );
}

let shown: React.ReactElement;

function render(props: Props) {
  let renderer: any;
  shown = sheet(props);
  act(() => {
    renderer = TestRenderer.create(shown);
  });
  return renderer;
}

function update(renderer: any, props: Props) {
  shown = sheet(props);
  act(() => renderer.update(React.cloneElement(shown)));
}

const modal = (renderer: any) => renderer.root.find((node: any) => node.type === 'Modal');
const container = (renderer: any) =>
  renderer.root.find((node: any) => node.type === 'AnimatedView' && node.props.onAccessibilityEscape);
const gesture = (renderer: any) => renderer.root.find((node: any) => node.type === 'GestureDetector').props.gesture;
/** Where the card stands; a test render reads shared values only when it renders again. */
function offset(renderer: any) {
  act(() => renderer.update(React.cloneElement(shown)));
  return container(renderer).props.style.flat().find((s: any) => s?.transform)?.transform[0].translateY;
}

function layOut(renderer: any) {
  act(() => {
    container(renderer).props.onLayout({ nativeEvent: { layout: { y: 0, height: SHEET_HEIGHT } } });
    renderer.root.findByProps({ testID: 'card' }).props.onLayout({ nativeEvent: { layout: { y: CARD_TOP, height: TRAVEL } } });
  });
}

function open(props: Partial<Props> = {}) {
  const renderer = render({ visible: true, ...props });
  layOut(renderer);
  act(finishAnimations);
  return renderer;
}

/** A finger on the card: down at y 300, moved by `dy`, let go at `velocity`. */
function drag(renderer: any, dy: number, velocity = 0) {
  const pan = gesture(renderer);
  act(() => {
    pan.onTouchesDown({ allTouches: [{ absoluteX: 100, absoluteY: 300 }] });
    pan.onTouchesMove({ handlerTag: 7, state: 2, numberOfTouches: 1, allTouches: [{ absoluteX: 100, absoluteY: 300 + Math.sign(dy) * 10 }] });
  });
  if (!(GestureStateManager.activate as jest.Mock).mock.calls.length) return;
  act(() => {
    pan.onActivate();
    pan.onUpdate({ translationY: dy });
  });
  act(() => pan.onDeactivate({ velocityY: velocity }));
}

beforeEach(() => {
  finishing.length = 0;
  jest.clearAllMocks();
  useReducedMotion.mockReturnValue(false);
  useSettingsStore.setState({ hapticEnabled: true });
});

describe('BottomSheetModal', () => {
  it('rides the card up from below its own height and taps once it lands', () => {
    const renderer = render({ visible: true });
    expect(modal(renderer).props).toMatchObject({ visible: true, animationType: 'none', transparent: true });

    layOut(renderer);
    expect(withSpring).toHaveBeenCalledWith(0, expect.objectContaining({ stiffness: 260, damping: 26, mass: 1 }));
    expect(fireSoftImpactHaptic).not.toHaveBeenCalled();

    act(finishAnimations);
    expect(offset(renderer)).toBe(0);
    expect(fireSoftImpactHaptic).toHaveBeenCalledTimes(1);
  });

  it('stays mounted while the card leaves, then hands over', () => {
    const onClosed = jest.fn();
    const renderer = open({ onClosed });

    update(renderer, { visible: false, onClosed });
    expect(modal(renderer).props.visible).toBe(true);
    expect(onClosed).not.toHaveBeenCalled();

    act(finishAnimations);
    expect(offset(renderer)).toBeGreaterThanOrEqual(TRAVEL);
    expect(modal(renderer).props.visible).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('closes through onClose when pulled past a quarter of the card', () => {
    const onClose = jest.fn();
    const renderer = open({ onClose });

    drag(renderer, TRAVEL * 0.3);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fireSoftImpactHaptic).toHaveBeenCalledTimes(2);
  });

  it('closes on a fast flick even when barely pulled', () => {
    const onClose = jest.fn();
    const renderer = open({ onClose });

    drag(renderer, TRAVEL * 0.05, 1200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('springs back from a short slow pull', () => {
    const onClose = jest.fn();
    const renderer = open({ onClose });

    drag(renderer, TRAVEL * 0.2, 300);
    expect(onClose).not.toHaveBeenCalled();
    expect(offset(renderer)).toBe(0);
  });

  it('follows a pull up only a quarter of the way', () => {
    const renderer = open();
    const pan = gesture(renderer);
    act(() => {
      pan.onTouchesDown({ allTouches: [{ absoluteX: 100, absoluteY: 300 }] });
      pan.onTouchesMove({ handlerTag: 7, state: 2, numberOfTouches: 1, allTouches: [{ absoluteX: 100, absoluteY: 290 }] });
      pan.onActivate();
      pan.onUpdate({ translationY: -100 });
    });
    expect(GestureStateManager.activate).toHaveBeenCalledWith(7);
    expect(offset(renderer)).toBe(-25);
  });

  it('lets scrolled content scroll back before the card moves', () => {
    const renderer = open({ scroll: true });
    const list = renderer.root.find((node: any) => node.type === 'ScrollView');
    act(() => list.props.onScroll({ nativeEvent: { contentOffset: { y: 120 } } }));

    drag(renderer, 100);
    expect(GestureStateManager.fail).toHaveBeenCalledWith(7);
    expect(GestureStateManager.activate).not.toHaveBeenCalled();

    act(() => list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
    drag(renderer, 100);
    expect(GestureStateManager.activate).toHaveBeenCalledWith(7);
  });

  it('closes from the dimming, Android back and the VoiceOver escape', () => {
    const onClose = jest.fn();
    const renderer = open({ onClose });
    const scrim = renderer.root.find((node: any) => node.props.accessibilityElementsHidden && node.props.onPress);

    act(() => scrim.props.onPress());
    act(() => modal(renderer).props.onRequestClose());
    act(() => container(renderer).props.onAccessibilityEscape());
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('only fades and takes no drag under Reduce Motion', () => {
    useReducedMotion.mockReturnValue(true);
    const onClosed = jest.fn();
    const renderer = render({ visible: true, onClosed });
    expect(modal(renderer).props.animationType).toBe('fade');
    expect(gesture(renderer).enabled).toBe(false);
    expect(offset(renderer)).toBeUndefined();

    update(renderer, { visible: false, onClosed });
    expect(modal(renderer).props.visible).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when haptics are off', () => {
    useSettingsStore.setState({ hapticEnabled: false });
    open();
    expect(fireSoftImpactHaptic).not.toHaveBeenCalled();
  });
});
