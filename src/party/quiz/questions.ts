/**
 * Otázky do pub kvízu.
 *
 * Bundled with the app, not fetched: everyone at the table has to see the same
 * question at the same moment, and a pub is exactly where the signal is worst.
 * The network carries who answered what — four bytes — never the content.
 *
 * What the pack is trying to be: pub trivia a Czech table can actually argue
 * about. Beer and pubs are the spine, but not all of it — a quiz that is only
 * about beer runs out after two rounds and stops being a quiz. No dates nobody
 * could know, no questions that are really a vocabulary test, and every wrong
 * answer plausible enough to be worth choosing.
 *
 * `answer` is an index into `options`. Kept as data rather than a flag on the
 * option so a question cannot end up with two right answers.
 */

import { t } from '@/i18n';

export interface QuizQuestion {
  id: string;
  text: string;
  options: readonly string[];
  /** Index into `options`. */
  answer: number;
}

/**
 * `answer` stays in code, next to nothing else: the index has to survive a
 * translation, so the words live in i18n and the right one is pinned here.
 */
export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  { id: 'q-plzen', ...t.quiz.questions.qPlzen, answer: 0 },
  { id: 'q-stupne', ...t.quiz.questions.qStupne, answer: 1 },
  { id: 'q-chmel', ...t.quiz.questions.qChmel, answer: 2 },
  { id: 'q-spotreba', ...t.quiz.questions.qSpotreba, answer: 3 },
  { id: 'q-tank', ...t.quiz.questions.qTank, answer: 0 },
  { id: 'q-lezak', ...t.quiz.questions.qLezak, answer: 2 },
  { id: 'q-cistonos', ...t.quiz.questions.qCistonos, answer: 1 },
  { id: 'q-svetle', ...t.quiz.questions.qSvetle, answer: 3 },
  { id: 'q-hospoda', ...t.quiz.questions.qHospoda, answer: 0 },
  { id: 'q-mlyn', ...t.quiz.questions.qMlyn, answer: 1 },
  { id: 'q-svatek', ...t.quiz.questions.qSvatek, answer: 2 },
  { id: 'q-slad', ...t.quiz.questions.qSlad, answer: 3 },
];
