import React from 'react';
import { Pressable, TextInput, UIManager, findNodeHandle } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { KeyboardAwareScrollView } from '../KeyboardAwareScrollView';

let mockKeyboardHeight = 200;
jest.mock('@/utils/useKeyboardHeight', () => ({
  useKeyboardHeight: () => mockKeyboardHeight,
}));

jest.mock('react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const ReactNative = jest.requireActual<typeof import('react-native')>('react-native');
  const scrollTo = jest.fn();
  const scrollInstance = { scrollTo };
  const currentlyFocusedInput = jest.fn();

  const MockScrollView = React.forwardRef(function MockScrollView(
    { children, ...props }: { children?: React.ReactNode; [key: string]: unknown },
    ref: React.ForwardedRef<{ scrollTo: typeof scrollTo }>,
  ) {
    React.useImperativeHandle(ref, () => scrollInstance);
    return React.createElement('ScrollView', props, children);
  });

  const MockTextInput = Object.assign(
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement('TextInput', props, children),
    { State: { currentlyFocusedInput } },
  );

  return {
    ...ReactNative,
    ScrollView: MockScrollView,
    TextInput: MockTextInput,
    UIManager: { measureLayout: jest.fn() },
    findNodeHandle: jest.fn(),
    __scrollTo: scrollTo,
  };
});

const mockedMeasureLayout = UIManager.measureLayout as jest.MockedFunction<typeof UIManager.measureLayout>;
const mockedFindNodeHandle = findNodeHandle as jest.MockedFunction<typeof findNodeHandle>;
const mockedCurrentlyFocusedInput = TextInput.State.currentlyFocusedInput as jest.MockedFunction<
  typeof TextInput.State.currentlyFocusedInput
>;
const mockedScrollTo = (
  jest.requireMock('react-native') as { __scrollTo: jest.Mock }
).__scrollTo;

const focusedInput = {} as React.ElementRef<typeof TextInput>;

describe('KeyboardAwareScrollView', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockKeyboardHeight = 200;
    mockedFindNodeHandle.mockImplementation((node) => (node === focusedInput ? 22 : 99));
    global.requestAnimationFrame = (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 16) as unknown as number;
    global.cancelAnimationFrame = (handle: number | null | undefined) => {
      if (handle != null) clearTimeout(handle);
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ignores focus from a descendant that is not the focused TextInput', () => {
    mockedCurrentlyFocusedInput.mockReturnValue(focusedInput);
    const screen = render(
      <KeyboardAwareScrollView>
        <Pressable testID="regular-control" />
      </KeyboardAwareScrollView>,
    );

    fireEvent(screen.getByTestId('regular-control'), 'focus', {
      target: 11,
      nativeEvent: { target: 11 },
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockedMeasureLayout).not.toHaveBeenCalled();
    expect(mockedScrollTo).not.toHaveBeenCalled();
  });

  it('clamps the target offset to the maximum scrollable content offset', () => {
    mockKeyboardHeight = 0;
    mockedCurrentlyFocusedInput.mockReturnValue(focusedInput);
    mockedMeasureLayout.mockImplementation((_target, _relativeTo, _onFail, onSuccess) => {
      onSuccess(0, 650, 100, 50);
    });
    const screen = render(
      <KeyboardAwareScrollView testID="scroll-view">
        <TextInput testID="field" />
      </KeyboardAwareScrollView>,
    );

    fireEvent(screen.getByTestId('scroll-view'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });
    fireEvent(screen.getByTestId('scroll-view'), 'contentSizeChange', 300, 500);
    fireEvent(screen.getByTestId('field'), 'focus', {
      target: 22,
      nativeEvent: { target: 22 },
    });
    act(() => {
      jest.advanceTimersByTime(16);
    });

    expect(mockedScrollTo).toHaveBeenCalledWith({ y: 100, animated: true });
  });

  it('uses the keyboard allowance to move a covered input fully above the keyboard', () => {
    mockedCurrentlyFocusedInput.mockReturnValue(focusedInput);
    mockedMeasureLayout.mockImplementation((_target, _relativeTo, _onFail, onSuccess) => {
      onSuccess(0, 350, 100, 50);
    });
    const screen = render(
      <KeyboardAwareScrollView testID="scroll-view">
        <TextInput testID="field" />
      </KeyboardAwareScrollView>,
    );

    fireEvent(screen.getByTestId('scroll-view'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });
    fireEvent(screen.getByTestId('scroll-view'), 'contentSizeChange', 300, 500);
    fireEvent(screen.getByTestId('field'), 'focus', {
      target: 22,
      nativeEvent: { target: 22 },
    });
    act(() => {
      jest.advanceTimersByTime(16);
    });

    // keyboardTop is 180, so a field ending at 400 needs exactly 220 px.
    expect(mockedScrollTo).toHaveBeenCalledWith({ y: 220, animated: true });
  });

  it('retries after the native keyboard animation so late layout changes are handled', () => {
    mockedCurrentlyFocusedInput.mockReturnValue(focusedInput);
    mockedMeasureLayout.mockImplementation((_target, _relativeTo, _onFail, onSuccess) => {
      onSuccess(0, 350, 100, 50);
    });
    const screen = render(
      <KeyboardAwareScrollView testID="scroll-view">
        <TextInput testID="field" />
      </KeyboardAwareScrollView>,
    );

    fireEvent(screen.getByTestId('scroll-view'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });
    fireEvent(screen.getByTestId('scroll-view'), 'contentSizeChange', 300, 500);
    fireEvent(screen.getByTestId('field'), 'focus', {
      target: 22,
      nativeEvent: { target: 22 },
    });

    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(mockedMeasureLayout).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(284);
    });
    expect(mockedMeasureLayout).toHaveBeenCalledTimes(2);
    expect(mockedScrollTo).toHaveBeenCalledTimes(2);
  });

  it('cancels the delayed second scroll when it unmounts', () => {
    mockedCurrentlyFocusedInput.mockReturnValue(focusedInput);
    mockedMeasureLayout.mockImplementation((_target, _relativeTo, _onFail, onSuccess) => {
      onSuccess(0, 350, 100, 50);
    });
    const screen = render(
      <KeyboardAwareScrollView testID="scroll-view">
        <TextInput testID="field" />
      </KeyboardAwareScrollView>,
    );

    fireEvent(screen.getByTestId('scroll-view'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });
    fireEvent(screen.getByTestId('scroll-view'), 'contentSizeChange', 300, 800);
    fireEvent(screen.getByTestId('field'), 'focus', {
      target: 22,
      nativeEvent: { target: 22 },
    });
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(mockedMeasureLayout).toHaveBeenCalledTimes(1);

    screen.unmount();
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(mockedMeasureLayout).toHaveBeenCalledTimes(1);
    expect(mockedScrollTo).toHaveBeenCalledTimes(1);
  });
});
