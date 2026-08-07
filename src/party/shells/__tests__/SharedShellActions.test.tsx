/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');
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

import { recordRoll, startDice } from '@/games/web/dice/rules';
import { DrawShell } from '@/party/shells/DrawShell';
import { DiceDuelShell } from '@/party/shells/DiceDuelShell';
import { PickShell } from '@/party/shells/PickShell';
import { PromptShell } from '@/party/shells/PromptShell';

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
  expect(onNext).toHaveBeenCalledTimes(1);
  // Controlled state cannot drift before the canonical fold advances.
  expect(screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel).toBe(first);

  view.rerender(
    <PromptShell prompts={['První', 'Druhá', 'Třetí']} seed={17} step={1} onNext={onNext} />,
  );
  expect(screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel).not.toBe(first);
});

it('persists the draw result and can render the same card after reconnect', () => {
  const onDraw = jest.fn();
  const view = render(
    <DrawShell kind="card" players={PLAYERS} action="Táhni kartu" result={null} onDraw={onDraw} />,
  );

  fireEvent.press(screen.getByLabelText('Táhni kartu'));
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
  expect(onRoll).toHaveBeenCalledWith({
    playerId: 'me',
    dice: [expect.any(Number), expect.any(Number)],
  });

  const afterMe = recordRoll(start, 'Ty', [6, 4]);
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

  const complete = recordRoll(afterMe, 'Honza', [2, 1]);
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
