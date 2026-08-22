import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(View, props, children),
    },
    Easing: { cubic: 'cubic', out: (value: unknown) => value },
    FadeIn: { duration: () => undefined },
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

const { recordRoll, startDice } = jest.requireActual('@/games/web/dice/rules') as typeof import('@/games/web/dice/rules');
const { DrawShell } = jest.requireActual('@/party/shells/DrawShell') as typeof import('@/party/shells/DrawShell');
const { DiceDuelShell } = jest.requireActual('@/party/shells/DiceDuelShell') as typeof import('@/party/shells/DiceDuelShell');
const { PickShell } = jest.requireActual('@/party/shells/PickShell') as typeof import('@/party/shells/PickShell');
const { PromptShell } = jest.requireActual('@/party/shells/PromptShell') as typeof import('@/party/shells/PromptShell');
const { KINGS_DECK } = jest.requireActual('@/party/gameContent') as typeof import('@/party/gameContent');

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

it('renders a prompt from the folded step and emits only an append action intent', () => {
  const onNext = jest.fn();
  const view = render(
    <PromptShell prompts={['První', 'Druhá', 'Třetí']} seed={17} step={0} onNext={onNext} />,
  );
  const first = screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel;

  fireEvent.press(screen.getByLabelText(/Ťukni pro další/));
  fireEvent.press(screen.getByLabelText(/Ťukni pro další/));
  expect(onNext).toHaveBeenCalledTimes(1);
  // Controlled state cannot drift before the canonical fold advances.
  expect(screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel).toBe(first);

  view.rerender(
    <PromptShell prompts={['První', 'Druhá', 'Třetí']} seed={17} step={1} onNext={onNext} />,
  );
  expect(screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel).not.toBe(first);
});

it('does not announce double punctuation after a complete prompt sentence', () => {
  render(
    <PromptShell
      prompts={['Už jsem to udělal.', 'Druhá věta.']}
      seed={17}
      step={0}
      onNext={() => {}}
    />,
  );

  expect(screen.getByLabelText(/\. Ťukni pro další\.$/)).toBeTruthy();
  expect(screen.queryByLabelText(/\.\. Ťukni pro další/)).toBeNull();
});

it('persists the draw result and can render the same card after reconnect', () => {
  const onDraw = jest.fn();
  const view = render(
    <DrawShell kind="card" players={PLAYERS} action="Táhni kartu" result={null} onDraw={onDraw} />,
  );

  fireEvent.press(screen.getByLabelText('Táhni kartu'));
  fireEvent.press(screen.getByLabelText('Táhni kartu'));
  expect(onDraw).toHaveBeenCalledTimes(1);
  expect(onDraw).toHaveBeenCalledWith(expect.objectContaining({ cardId: expect.any(String) }));

  view.rerender(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={{ nonce: 'server-event-7', cardId: 'K' }}
      onDraw={onDraw}
    />,
  );
  expect(screen.getByText('Král')).toBeTruthy();
  expect(screen.getByText('Doprostřed. Čtvrtý král platí rundu pro stůl.')).toBeTruthy();
});

it('draws the only remaining fourth king and finishes the persisted deck', () => {
  jest.useFakeTimers();
  const onDraw = jest.fn();
  const onDeckFinished = jest.fn();
  const remaining = 'spades-K';
  render(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={null}
      drawnCardIds={KINGS_DECK.map((card) => card.id).filter((id) => id !== remaining)}
      onDraw={onDraw}
      onDeckFinished={onDeckFinished}
    />,
  );

  fireEvent.press(screen.getByLabelText('Táhni kartu'));
  expect(onDraw).toHaveBeenCalledWith(expect.objectContaining({ cardId: remaining }));
  act(() => jest.advanceTimersByTime(700));
  expect(onDeckFinished).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('uses stable player ids for a pick and rehydrates the same verdict', () => {
  const onPicked = jest.fn();
  const view = render(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId={null}
      onPicked={onPicked}
    />,
  );

  fireEvent.press(screen.getByLabelText('Roztoč'));
  fireEvent.press(screen.getByLabelText('Roztoč'));
  expect(onPicked).toHaveBeenCalledTimes(1);
  expect(['me', 'honza']).toContain(onPicked.mock.calls[0][0]);

  view.rerender(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId="honza"
      onPicked={onPicked}
    />,
  );
  expect(screen.getByText('Honza je na řadě')).toBeTruthy();
});

it('emits dice results from the game and renders a cold-restarted fold', () => {
  const onRoll = jest.fn();
  const onNextRound = jest.fn();
  const start = startDice(PLAYERS);
  const view = render(
    <DiceDuelShell
      players={PLAYERS}
      state={start}
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByLabelText('Hodit za Ty'));
  fireEvent.press(screen.getByLabelText('Hodit za Ty'));
  expect(onRoll).toHaveBeenCalledTimes(1);
  expect(onRoll).toHaveBeenCalledWith({
    playerId: 'me',
    dice: [expect.any(Number), expect.any(Number)],
  });

  const afterMe = recordRoll(start, 'me', [6, 4]);
  view.rerender(
    <DiceDuelShell
      players={PLAYERS}
      state={afterMe}
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Hodit za Honza')).toBeTruthy();

  const complete = recordRoll(afterMe, 'honza', [2, 1]);
  view.rerender(
    <DiceDuelShell
      players={PLAYERS}
      state={complete}
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByLabelText('Další kolo'));
  expect(onNextRound).toHaveBeenCalledTimes(1);
});
