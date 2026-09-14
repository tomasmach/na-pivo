/**
 * Optimistic shell locks must recover on their own when the canonical update
 * never comes.
 *
 * Every controlled shell here optimistically locks after one press and waits
 * for canonical props to advance. When the callback is dropped, rejected or
 * loses a race, the props never advance and older builds stayed locked for the
 * rest of the game. These tests pin the contract: one press, no-op callback,
 * a bounded recovery interval, then the same gesture works again — while a
 * rapid double tap still fires exactly once.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  const { Text, View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(View, props, children),
      Text: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(Text, props, children),
    },
    Easing: { cubic: 'cubic', out: (value: unknown) => value },
    FadeIn: { duration: () => undefined },
    FadeInDown: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => true,
    useSharedValue: (value: unknown) => ({ value }),
    withSequence: (...values: unknown[]) => values.at(-1),
    withTiming: (value: unknown) => value,
  };
});
jest.mock('@/games/GameHost', () => ({
  GAME_HOST_AVAILABLE: false,
  GameHost: () => null,
}));
jest.mock('@/games/GameResult', () => ({ GameResult: () => null }));

const { startDice } = jest.requireActual('@/games/web/dice/rules') as typeof import('@/games/web/dice/rules');
const { QUIZ_QUESTIONS } = jest.requireActual('@/party/quiz/questions') as typeof import('@/party/quiz/questions');
const { PromptShell } = jest.requireActual('@/party/shells/PromptShell') as typeof import('@/party/shells/PromptShell');
const { DrawShell } = jest.requireActual('@/party/shells/DrawShell') as typeof import('@/party/shells/DrawShell');
const { PickShell } = jest.requireActual('@/party/shells/PickShell') as typeof import('@/party/shells/PickShell');
const { DiceDuelShell } = jest.requireActual('@/party/shells/DiceDuelShell') as typeof import('@/party/shells/DiceDuelShell');
const { QuizShell } = jest.requireActual('@/party/shells/QuizShell') as typeof import('@/party/shells/QuizShell');

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

/** Longer than any recovery bound under test; advances every pending lock. */
const BEYOND_RECOVERY = 5000;

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('Prompt: recovers when onNext is ignored and step never advances', () => {
  const onNext = jest.fn();
  render(<PromptShell prompts={['První', 'Druhá']} seed={7} step={4} onNext={onNext} />);
  const card = screen.getByLabelText(/Ťukni pro další/);
  const before = card.props.accessibilityLabel;

  fireEvent.press(card);
  fireEvent.press(card);
  expect(onNext).toHaveBeenCalledTimes(1);
  // Controlled props stay untouched: the card cannot drift before the fold.
  expect(screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel).toBe(before);

  act(() => {
    jest.advanceTimersByTime(BEYOND_RECOVERY);
  });
  fireEvent.press(screen.getByLabelText(/Ťukni pro další/));
  expect(onNext).toHaveBeenCalledTimes(2);
});

it('Prompt: canonical advancement unlocks immediately without waiting', () => {
  const onNext = jest.fn();
  const view = render(
    <PromptShell prompts={['První', 'Druhá']} seed={7} step={4} onNext={onNext} />,
  );

  fireEvent.press(screen.getByLabelText(/Ťukni pro další/));
  view.rerender(<PromptShell prompts={['První', 'Druhá']} seed={7} step={5} onNext={onNext} />);

  fireEvent.press(screen.getByLabelText(/Ťukni pro další/));
  expect(onNext).toHaveBeenCalledTimes(2);
});

it('Draw: recovers when a reduced-motion draw callback is ignored', () => {
  const onDraw = jest.fn();
  render(
    <DrawShell kind="person" players={PLAYERS} action="Roztoč" result={null} onDraw={onDraw} />,
  );
  const button = screen.getByLabelText('Roztoč');

  fireEvent.press(button);
  fireEvent.press(button);
  expect(onDraw).toHaveBeenCalledTimes(1);

  act(() => {
    jest.advanceTimersByTime(BEYOND_RECOVERY);
  });
  fireEvent.press(screen.getByLabelText(/Roztoč/));
  expect(onDraw).toHaveBeenCalledTimes(2);
});

it('Pick: recovers when a reduced-motion pick callback is ignored', () => {
  const onPicked = jest.fn();
  render(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId="honza"
      pickRevision={1}
      onPicked={onPicked}
    />,
  );
  const button = screen.getByLabelText('Roztoč znovu');

  fireEvent.press(button);
  fireEvent.press(button);
  expect(onPicked).toHaveBeenCalledTimes(1);

  act(() => {
    jest.advanceTimersByTime(BEYOND_RECOVERY);
  });
  fireEvent.press(screen.getByLabelText(/Roztoč/));
  expect(onPicked).toHaveBeenCalledTimes(2);
});

it('Dice: recovers when a controlled reduced-motion roll callback is ignored', () => {
  const onRoll = jest.fn();
  render(
    <DiceDuelShell
      players={PLAYERS}
      state={startDice(PLAYERS)}
      onRoll={onRoll}
      onNextRound={jest.fn()}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  const button = screen.getByLabelText('Hodit za Ty');

  fireEvent.press(button);
  fireEvent.press(button);
  expect(onRoll).toHaveBeenCalledTimes(1);

  act(() => {
    jest.advanceTimersByTime(BEYOND_RECOVERY);
  });
  fireEvent.press(screen.getByLabelText(/Hodit za/));
  expect(onRoll).toHaveBeenCalledTimes(2);
});

it('Quiz: recovers when an answer callback is ignored and answers never advance', () => {
  const onAnswer = jest.fn();
  render(
    <QuizShell
      entrants={[
        { id: 'me', teamId: 'me', teamName: 'Ty' },
        { id: 'honza', teamId: 'honza', teamName: 'Honza' },
      ]}
      answers={[]}
      me="me"
      index={0}
      tintOf={() => '#111'}
      onAnswer={onAnswer}
      onReveal={jest.fn()}
      onNext={jest.fn()}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  const firstOption = QUIZ_QUESTIONS[0].options[0];

  fireEvent.press(screen.getByText(firstOption));
  fireEvent.press(screen.getByText(firstOption));
  expect(onAnswer).toHaveBeenCalledTimes(1);

  act(() => {
    jest.advanceTimersByTime(BEYOND_RECOVERY);
  });
  fireEvent.press(screen.getByText(firstOption));
  expect(onAnswer).toHaveBeenCalledTimes(2);
});
