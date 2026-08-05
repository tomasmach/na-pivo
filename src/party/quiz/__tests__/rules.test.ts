import {
  hasAnswered,
  quizState,
  quizWinner,
  teamsOf,
  type QuizAnswer,
  type QuizEntrant,
} from '@/party/quiz/rules';
import type { QuizQuestion } from '@/party/quiz/questions';

const QUESTIONS: QuizQuestion[] = [
  { id: 'a', text: 'A?', options: ['ne', 'ano'], answer: 1 },
  { id: 'b', text: 'B?', options: ['ano', 'ne'], answer: 0 },
];

/** Two teams of two, which is the case a per-person implementation gets wrong. */
const TEAMS: QuizEntrant[] = [
  { id: 'p1', teamId: 't1', teamName: 'Štamgasti' },
  { id: 'p2', teamId: 't1', teamName: 'Štamgasti' },
  { id: 'p3', teamId: 't2', teamName: 'Nováčci' },
  { id: 'p4', teamId: 't2', teamName: 'Nováčci' },
];

/** Alone at a table: everyone is their own team. */
const SOLO: QuizEntrant[] = [
  { id: 'Ty', teamId: 'Ty', teamName: 'Ty' },
  { id: 'Honza', teamId: 'Honza', teamName: 'Honza' },
];

const answer = (entrantId: string, questionId: string, option: number, at: number): QuizAnswer => ({
  entrantId,
  questionId,
  option,
  at,
});

describe('quiz rules', () => {
  it('scores a team once, from whichever member answered first', () => {
    // The second member gets it right, but too late — the team already spoke.
    const answers = [answer('p1', 'a', 0, 10), answer('p2', 'a', 1, 20)];
    const state = quizState({ entrants: TEAMS, answers, index: 0, questions: QUESTIONS });

    expect(state.standings.find((row) => row.teamId === 't1')?.score).toBe(0);
  });

  it('does not let a team brute-force by covering every option', () => {
    // All four options from one team. Only the first counts, so a team can no
    // more guarantee a point than a single player could.
    const answers = [
      answer('p1', 'a', 0, 10),
      answer('p2', 'a', 1, 11),
      answer('p1', 'a', 1, 12),
      answer('p2', 'a', 0, 13),
    ];
    const state = quizState({ entrants: TEAMS, answers, index: 0, questions: QUESTIONS });

    expect(state.standings.find((row) => row.teamId === 't1')?.score).toBe(0);
  });

  it('treats a lone player as a team of one', () => {
    const answers = [answer('Ty', 'a', 1, 10)];
    const state = quizState({ entrants: SOLO, answers, index: 0, questions: QUESTIONS });

    expect(teamsOf(SOLO)).toHaveLength(2);
    expect(state.standings.find((row) => row.teamId === 'Ty')?.score).toBe(1);
  });

  it('knows when the room has finished a question', () => {
    const one = quizState({
      entrants: SOLO,
      answers: [answer('Ty', 'a', 1, 10)],
      index: 0,
      questions: QUESTIONS,
    });
    const both = quizState({
      entrants: SOLO,
      answers: [answer('Ty', 'a', 1, 10), answer('Honza', 'a', 0, 12)],
      index: 0,
      questions: QUESTIONS,
    });

    expect(one.complete).toBe(false);
    expect(both.complete).toBe(true);
  });

  it('is the same however the answers are ordered', () => {
    // Two phones, no shared clock, frames arriving in any order: the fold has to
    // land on one answer regardless.
    const forwards = [answer('p1', 'a', 1, 10), answer('p2', 'a', 0, 20)];
    const backwards = [...forwards].reverse();

    expect(quizState({ entrants: TEAMS, answers: forwards, index: 0, questions: QUESTIONS })).toEqual(
      quizState({ entrants: TEAMS, answers: backwards, index: 0, questions: QUESTIONS }),
    );
  });

  it('locks the whole team once any member has answered', () => {
    const answers = [answer('p1', 'a', 1, 10)];

    expect(hasAnswered(answers, TEAMS, 'p2', 'a')).toBe(true);
    expect(hasAnswered(answers, TEAMS, 'p3', 'a')).toBe(false);
  });

  it('leaves a shared top as a tie rather than inventing a tie-break', () => {
    const answers = [answer('Ty', 'a', 1, 10), answer('Honza', 'a', 1, 11)];
    const state = quizState({ entrants: SOLO, answers, index: 0, questions: QUESTIONS });

    expect(quizWinner(state.standings)).toBeNull();
  });

  it('crowns nobody when nobody scored', () => {
    const answers = [answer('Ty', 'a', 0, 10), answer('Honza', 'a', 0, 11)];
    const state = quizState({ entrants: SOLO, answers, index: 0, questions: QUESTIONS });

    expect(quizWinner(state.standings)).toBeNull();
  });

  it('is finished once the questions run out', () => {
    const state = quizState({ entrants: SOLO, answers: [], index: 2, questions: QUESTIONS });

    expect(state.finished).toBe(true);
    expect(state.question).toBeNull();
  });
});
