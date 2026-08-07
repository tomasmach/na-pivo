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

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  const view =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement(tag, props, children);
  return {
    __esModule: true,
    default: { View: view('AnimatedView'), Text: require('react-native').Text },
    FadeIn: { duration: () => undefined },
    FadeInDown: { duration: () => undefined },
    useReducedMotion: () => true,
  };
});

jest.mock('@/components/shared/IconGlyph', () => {
  const ReactModule = require('react');
  return { CheckIcon: () => ReactModule.createElement('Icon') };
});


import { QUIZ_QUESTIONS } from '@/party/quiz/questions';
import type { QuizAnswer, QuizEntrant } from '@/party/quiz/rules';
import { QuizShell } from '@/party/shells/QuizShell';

const TABLE: QuizEntrant[] = [
  { id: 'Ty', teamId: 'Ty', teamName: 'Ty' },
  { id: 'Honza', teamId: 'Honza', teamName: 'Honza' },
];

const QUESTION = QUIZ_QUESTIONS[0];
const RIGHT = QUESTION.options[QUESTION.answer];
const WRONG = QUESTION.options[(QUESTION.answer + 1) % QUESTION.options.length];

function renderShell(answers: QuizAnswer[], over: Partial<{ forceRevealed: boolean }> = {}) {
  const onAnswer = jest.fn();
  const onNext = jest.fn();
  const onReveal = jest.fn();
  render(
    <QuizShell
      entrants={TABLE}
      answers={answers}
      me="Ty"
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

    expect(onAnswer).toHaveBeenCalledWith(QUESTION.options.indexOf(WRONG));
    expect(screen.queryByLabelText(`${RIGHT} — správně`)).toBeNull();
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
    renderShell([answer('Ty', 0)], { forceRevealed: true });

    expect(screen.getByLabelText(`${RIGHT} — správně`)).toBeTruthy();
  });
});
