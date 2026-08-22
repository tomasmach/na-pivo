import { QUIZ_QUESTIONS } from '@/party/quiz/questions';

it('has valid unique questions without a guessable answer-position pattern', () => {
  expect(new Set(QUIZ_QUESTIONS.map((question) => question.id)).size).toBe(QUIZ_QUESTIONS.length);
  const positions = new Map<number, number>();
  for (const question of QUIZ_QUESTIONS) {
    expect(question.answer).toBeGreaterThanOrEqual(0);
    expect(question.answer).toBeLessThan(question.options.length);
    positions.set(question.answer, (positions.get(question.answer) ?? 0) + 1);
  }
  expect([...positions.values()]).toEqual([3, 3, 3, 3]);
});

it('describes tank beer and šnyt without the known factual errors', () => {
  const tank = QUIZ_QUESTIONS.find((question) => question.id === 'q-tank')!;
  const snyt = QUIZ_QUESTIONS.find((question) => question.id === 'q-hospoda')!;
  expect(tank.options[tank.answer]).not.toMatch(/nefiltrovan/i);
  expect(snyt.options[snyt.answer]).not.toMatch(/půl piva a půl pěny/i);
});
