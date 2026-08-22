/**
 * Interaction tests for the pub-quiz screen (src/party/shells/QuizShell.tsx).
 *
 * The rules are tested separately as a fold. What is tested here is the part the
 * rules cannot enforce: that the screen does not leak the answer early. On
 * several phones, revealing before everybody has committed means the fastest
 * person can read it out loud — so "locked" and "revealed" being two different
 * states is the whole design, not a nicety.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';


import { QUIZ_QUESTIONS } from '@/party/quiz/questions';
import type { QuizAnswer, QuizEntrant } from '@/party/quiz/rules';
import { QuizShell } from '@/party/shells/QuizShell';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  const view =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement(tag, props, children);
  return {
    __esModule: true,
    default: { View: view('AnimatedView'), Text: jest.requireActual('react-native').Text },
    FadeIn: { duration: () => undefined },
    FadeInDown: { duration: () => undefined },
    useReducedMotion: () => true,
  };
});

jest.mock('@/components/shared/IconGlyph', () => {
  const ReactModule = jest.requireActual('react');
  return { CheckIcon: () => ReactModule.createElement('Icon') };
});

const TABLE: QuizEntrant[] = [
  { id: 'Ty', teamId: 'Ty', teamName: 'Ty' },
  { id: 'Honza', teamId: 'Honza', teamName: 'Honza' },
];

const QUESTION = QUIZ_QUESTIONS[0];
const RIGHT = QUESTION.options[QUESTION.answer];
const WRONG = QUESTION.options[(QUESTION.answer + 1) % QUESTION.options.length];

function renderShell(
  answers: QuizAnswer[],
  over: Partial<{ forceRevealed: boolean; me: string }> = {},
) {
  const onAnswer = jest.fn();
  const onNext = jest.fn();
  const onReveal = jest.fn();
  render(
    <QuizShell
      entrants={TABLE}
      answers={answers}
      me={over.me ?? 'Ty'}
      index={0}
      tintOf={() => '#E8A33D'}
      forceRevealed={over.forceRevealed ?? false}
      onAnswer={onAnswer}
      onReveal={onReveal}
      onNext={onNext}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  return { onAnswer, onNext, onReveal };
}

const answer = (entrantId: string, option: number): QuizAnswer => ({
  entrantId,
  questionId: QUESTION.id,
  option,
  at: 1000,
});

describe('QuizShell', () => {
  it('asks before anybody has answered', () => {
    renderShell([]);

    expect(screen.getByText(QUESTION.text)).toBeTruthy();
    expect(screen.queryByText(/Zamknuto/)).toBeNull();
  });

  it('reports the tap once and does not reveal on it', () => {
    // Only this phone has answered. Honza is still reading.
    const { onAnswer } = renderShell([]);
    fireEvent.press(screen.getByText(WRONG));
    fireEvent.press(screen.getByText(RIGHT));

    expect(onAnswer).toHaveBeenCalledWith(QUESTION.options.indexOf(WRONG));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(`${RIGHT} — správně`)).toBeNull();
  });

  it('does not leak whether the locked answer scored through the board', () => {
    renderShell([answer('Ty', QUESTION.answer)]);

    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.queryByText('1')).toBeNull();
  });

  it('locks and names who the table is waiting for', () => {
    renderShell([answer('Ty', 0)]);

    expect(screen.getByText('Zamknuto. Chybí Honza')).toBeTruthy();
    // Locked means locked: a second tap must not reach the handler.
    expect(screen.queryByLabelText(`${RIGHT} — správně`)).toBeNull();
  });

  it('reveals once everybody has committed', () => {
    renderShell([answer('Ty', 0), answer('Honza', 1)]);

    expect(screen.getByLabelText(`${RIGHT} — správně`)).toBeTruthy();
    expect(screen.getByText('Další otázka')).toBeTruthy();
  });

  it('lets the table stop waiting for a phone that is not coming back', () => {
    const { onReveal } = renderShell([answer('Ty', 0)]);
    fireEvent.press(screen.getByLabelText('Ukázat odpověď bez čekání'));

    expect(onReveal).toHaveBeenCalled();
  });

  it('reveals when told to, without the missing answer', () => {
    const { onAnswer } = renderShell([answer('Ty', 0)], { forceRevealed: true });

    expect(screen.getByLabelText(`${RIGHT} — správně`)).toBeTruthy();
    fireEvent.press(screen.getByText(WRONG));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('never lets a spectator submit an answer', () => {
    const { onAnswer } = renderShell([], { me: 'spectator' });

    fireEvent.press(screen.getByText(WRONG));
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.getByLabelText(WRONG).props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });
});

describe('QuizShell spectator mode', () => {
  function renderSpectator(
    answers: QuizAnswer[],
    over: Partial<{ index: number; me: string }> = {},
  ) {
    const onAnswer = jest.fn();
    const onNext = jest.fn();
    const onReveal = jest.fn();
    const onFinished = jest.fn();
    render(
      <QuizShell
        entrants={TABLE}
        answers={answers}
        me={over.me ?? 'Ty'}
        index={over.index ?? 0}
        tintOf={() => '#E8A33D'}
        forceRevealed={false}
        onAnswer={onAnswer}
        onReveal={onReveal}
        onNext={onNext}
        onFinished={onFinished}
        onDone={jest.fn()}
        spectator
      />,
    );
    return { onAnswer, onNext, onReveal, onFinished };
  }

  it('sees the canonical question but cannot answer it', () => {
    const { onAnswer } = renderSpectator([]);

    expect(screen.getByText(QUESTION.text)).toBeTruthy();
    fireEvent.press(screen.getByText(WRONG));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('cannot force the reveal while the table waits', () => {
    const { onReveal } = renderSpectator([answer('Ty', QUESTION.answer)]);

    const reveal = screen.queryByLabelText('Ukázat odpověď bez čekání');
    expect(reveal).toBeNull();
    if (reveal) fireEvent.press(reveal);
    expect(onReveal).not.toHaveBeenCalled();
  });

  it('sees the canonical reveal but cannot advance', () => {
    const { onNext } = renderSpectator([answer('Ty', 0), answer('Honza', 1)]);

    expect(screen.getByLabelText(`${RIGHT} — správně`)).toBeTruthy();
    expect(screen.queryByText('Další otázka')).toBeNull();
    expect(screen.queryByText('Výsledky')).toBeNull();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('does not auto-report a finished quiz but keeps the result visible', () => {
    const { onFinished } = renderSpectator([], { index: QUIZ_QUESTIONS.length });

    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByText('Dohráno')).toBeTruthy();
  });
});
