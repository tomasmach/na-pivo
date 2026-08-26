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
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';


import { QUIZ_QUESTIONS } from '@/party/quiz/questions';
import { quizState, type QuizAnswer, type QuizEntrant } from '@/party/quiz/rules';
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
  it('gives the four tiles the rest of the stage, in two equal rows', () => {
    renderShell([]);

    const tiles = QUESTION.options.map((option) => {
      const style = screen.getByLabelText(option).props.style;
      return StyleSheet.flatten(
        typeof style === 'function' ? style({ pressed: false }) : style,
      );
    });
    // Every tile grows the same amount, so no answer is bigger than another and
    // none of them stops halfway down the table.
    for (const tile of tiles) {
      expect(tile.flex).toBe(1);
      expect(tile.minHeight).toBe(tiles[0].minHeight);
    }
    expect(tiles).toHaveLength(4);
  });

  it('waits for a durable finish and retries the exact quiz result after failure', async () => {
    const answers: QuizAnswer[] = QUIZ_QUESTIONS.flatMap((question, index) => [
      {
        entrantId: 'Ty',
        questionId: question.id,
        option: question.answer,
        at: index * 2,
      },
      {
        entrantId: 'Honza',
        questionId: question.id,
        option: (question.answer + 1) % question.options.length,
        at: index * 2 + 1,
      },
    ]);
    let resolveFirst!: (stored: boolean) => void;
    const onFinished = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise<boolean>((resolve) => { resolveFirst = resolve; }),
      )
      .mockResolvedValueOnce(true);

    render(
      <QuizShell
        entrants={TABLE}
        answers={answers}
        me="Ty"
        index={QUIZ_QUESTIONS.length}
        tintOf={() => '#E8A33D'}
        onAnswer={jest.fn()}
        onReveal={jest.fn()}
        onNext={jest.fn()}
        onFinished={onFinished}
        onDone={jest.fn()}
      />,
    );

    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Konec')).toBeNull();

    await act(async () => {
      resolveFirst(false);
      await Promise.resolve();
    });
    const retry = await screen.findByLabelText('Zkusit znovu');
    expect(screen.queryByLabelText('Konec')).toBeNull();

    fireEvent.press(retry);
    fireEvent.press(retry);
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(2));
    expect(onFinished.mock.calls[1]).toEqual(onFinished.mock.calls[0]);
    await waitFor(() => expect(screen.getByLabelText('Konec')).toBeTruthy());
  });

  it('reports stable team ids when two teams share a display name', async () => {
    const entrants: QuizEntrant[] = [
      { id: 'phone-a', teamId: 'team-a', teamName: 'Alex' },
      { id: 'phone-b', teamId: 'team-b', teamName: 'Alex' },
    ];
    const answers: QuizAnswer[] = QUIZ_QUESTIONS.flatMap((question, index) => [
      {
        entrantId: 'phone-a',
        questionId: question.id,
        option: question.answer,
        at: index * 2,
      },
      {
        entrantId: 'phone-b',
        questionId: question.id,
        option: (question.answer + 1) % question.options.length,
        at: index * 2 + 1,
      },
    ]);
    const onFinished = jest.fn(async () => true);
    const tintOf = jest.fn((id: string) => id === 'team-a' ? '#111111' : '#222222');

    render(
      <QuizShell
        entrants={entrants}
        answers={answers}
        me="phone-a"
        index={QUIZ_QUESTIONS.length}
        tintOf={tintOf}
        onAnswer={jest.fn()}
        onReveal={jest.fn()}
        onNext={jest.fn()}
        onFinished={onFinished}
        onDone={jest.fn()}
      />,
    );

    await waitFor(() => expect(onFinished).toHaveBeenCalledWith({
      winner: 'Alex',
      winnerId: 'team-a',
      standings: [
        { name: 'Alex', playerId: 'team-a', score: QUIZ_QUESTIONS.length },
        { name: 'Alex', playerId: 'team-b', score: 0 },
      ],
    }));
    expect(tintOf).toHaveBeenCalledWith('team-a');
    expect(tintOf).toHaveBeenCalledWith('team-b');
    expect(tintOf).not.toHaveBeenCalledWith('Alex');
  });

  it('reserves the bottom lane for the game beer action', () => {
    renderShell([]);

    expect(
      screen
        .UNSAFE_getAllByType(View)
        .some((node) => StyleSheet.flatten(node.props.style)?.paddingBottom === 122),
    ).toBe(true);
  });

  it('letters the four tiles, so the table can shout "béčko" across the noise', () => {
    renderShell([]);

    ['A', 'B', 'C', 'D'].forEach((letter) => {
      expect(screen.getByText(letter)).toBeTruthy();
    });
  });

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

    expect(screen.getAllByLabelText(/^(Ty|Honza) 0$/)).toHaveLength(2);
    expect(screen.queryByLabelText(/^(Ty|Honza) [1-9]\d*$/)).toBeNull();
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

  it('asks each new question as a polite live header', () => {
    renderShell([]);

    const question = screen.getByText(QUESTION.text);
    expect(question.props.accessibilityRole).toBe('header');
    expect(question.props.accessibilityLiveRegion).toBe('polite');
  });

  it('keeps the locked wait a polite live text without swallowing Nečekat', () => {
    renderShell([answer('Ty', 0)]);

    expect(
      screen.getByText('Zamknuto. Chybí Honza').props.accessibilityLiveRegion,
    ).toBe('polite');
    expect(screen.getByLabelText('Ukázat odpověď bez čekání')).toBeTruthy();
  });

  it('makes the revealed correct answer an assertive live region and keeps the wrong pick selected', () => {
    renderShell([
      answer('Ty', QUESTION.options.indexOf(WRONG)),
      answer('Honza', QUESTION.answer),
    ]);

    const right = screen.getByLabelText(`${RIGHT} — správně`);
    expect(right.props.accessibilityLiveRegion).toBe('assertive');

    const wrong = screen.getByLabelText(WRONG);
    expect(wrong.props.accessibilityState.selected).toBe(true);
    expect(screen.queryByText(/špatně/i)).toBeNull();
  });

  it('reads each standings row as one entry built from the visible name and score', () => {
    const answers = [answer('Ty', 0), answer('Honza', 1)];
    renderShell(answers);

    const state = quizState({ entrants: TABLE, answers, index: 0 });
    for (const row of state.standings) {
      expect(screen.getByLabelText(`${row.teamName} ${row.score}`)).toBeTruthy();
    }
  });
});

describe('QuizShell iOS announcements', () => {
  // The repo RN mock is partial: announceForAccessibility is attached here and
  // removed again so other suites sharing the mock stay untouched.
  const announce = jest.fn();
  const realOS = Platform.OS;

  beforeEach(() => {
    (AccessibilityInfo as unknown as Record<string, unknown> &
      typeof AccessibilityInfo).announceForAccessibility = announce;
    Platform.OS = 'ios';
    announce.mockClear();
  });

  afterEach(() => {
    Platform.OS = realOS;
  });

  afterAll(() => {
    const partial = AccessibilityInfo as unknown as Record<string, unknown>;
    delete partial.announceForAccessibility;
    Platform.OS = realOS;
  });

  function shellProps(
    answers: QuizAnswer[],
    index: number,
  ): React.ComponentProps<typeof QuizShell> {
    return {
      entrants: TABLE,
      answers,
      me: 'Ty',
      index,
      tintOf: () => '#E8A33D',
      forceRevealed: false,
      onAnswer: jest.fn(),
      onReveal: jest.fn(),
      onNext: jest.fn(),
      onFinished: jest.fn(),
      onDone: jest.fn(),
    };
  }

  it('announces the question imperatively only when its id changes', () => {
    const view = render(<QuizShell {...shellProps([], 0)} />);
    expect(announce).not.toHaveBeenCalled();

    view.rerender(<QuizShell {...shellProps([], 1)} />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(QUIZ_QUESTIONS[1].text);

    view.rerender(
      <QuizShell {...shellProps([], 1)} tintOf={() => '#000000'} />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces the exact waiting line when locking, once, and keeps Nečekat focusable', () => {
    const view = render(<QuizShell {...shellProps([], 0)} />);
    expect(announce).not.toHaveBeenCalled();

    view.rerender(<QuizShell {...shellProps([answer('Ty', 0)], 0)} />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('Zamknuto. Chybí Honza');
    expect(screen.getByLabelText('Ukázat odpověď bez čekání')).toBeTruthy();

    view.rerender(<QuizShell {...shellProps([answer('Ty', 0)], 0)} />);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('announces the revealed correct label once on lock-to-reveal without repeating question or waiting', () => {
    const view = render(<QuizShell {...shellProps([answer('Ty', 0)], 0)} />);
    announce.mockClear();

    view.rerender(
      <QuizShell
        {...shellProps([answer('Ty', 0), answer('Honza', QUESTION.answer)], 0)}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(`${RIGHT} — správně`);

    view.rerender(
      <QuizShell
        {...shellProps([answer('Ty', 0), answer('Honza', QUESTION.answer)], 0)}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('makes zero imperative calls on android across the same transitions', () => {
    Platform.OS = 'android';
    const view = render(<QuizShell {...shellProps([], 0)} />);
    view.rerender(<QuizShell {...shellProps([answer('Ty', 0)], 0)} />);
    view.rerender(
      <QuizShell
        {...shellProps([answer('Ty', 0), answer('Honza', QUESTION.answer)], 0)}
      />,
    );
    expect(announce).not.toHaveBeenCalled();
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

  it('waits for the canonical finish instead of inventing a spectator result', () => {
    const { onFinished } = renderSpectator([], { index: QUIZ_QUESTIONS.length });

    expect(onFinished).not.toHaveBeenCalled();
    expect(screen.getByText('Čekám na výsledek…')).toBeTruthy();
    expect(screen.queryByText('Dohráno')).toBeNull();
  });
});
