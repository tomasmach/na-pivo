import { quizFinishResult, quizState, type QuizEntrant } from '@/party/quiz/rules';

const questions = [
  { id: 'q1', text: 'Kde se va\u0159\u00ed Plze\u0148?', options: ['Plze\u0148', 'Brno'], answer: 0 },
  { id: 'q2', text: 'Kolik stup\u0148\u016f m\u00e1 le\u017e\u00e1k?', options: ['12', '8'], answer: 0 },
] as const;

const entrants: QuizEntrant[] = [
  { id: 'a', teamId: 'a', teamName: 'machtest' },
  { id: 'b', teamId: 'b', teamName: 'H\u0159\u00e1\u010d 20' },
];

it('reports the live scoreboard when the quiz is stopped early', () => {
  // One revealed correct answer: the scoreboard says machtest 1, so the result
  // screen must not say machtest 0.
  const state = quizState({
    entrants,
    answers: [{ entrantId: 'a', questionId: 'q1', option: 0, at: 1 }],
    index: 0,
    questions,
  });

  expect(quizFinishResult(state)).toEqual({
    winner: 'machtest',
    winnerId: 'a',
    scores: [
      { name: 'machtest', score: 1, playerId: 'a' },
      { name: 'H\u0159\u00e1\u010d 20', score: 0, playerId: 'b' },
    ],
  });
});

it('names nobody when nothing has been answered yet', () => {
  const state = quizState({ entrants, answers: [], index: 0, questions });
  const result = quizFinishResult(state);

  expect(result.winner).toBeNull();
  expect(result.winnerId).toBeNull();
  expect(result.scores.map((row) => row.score)).toEqual([0, 0]);
});
