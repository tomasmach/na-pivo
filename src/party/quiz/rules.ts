/**
 * Pub kvíz — the rules, as a fold over answers.
 *
 * Two places this gets played, and they are the same game:
 *
 *   party    everyone at the table on their own phone, scoring for themselves
 *   event    a room full of tables, scoring for their team
 *
 * So the unit of scoring is a TEAM throughout, and a person playing alone is a
 * team of one. Written the other way round — people first, teams bolted on later
 * — every rule below would need a second version, and the two would drift.
 *
 * State is derived from an append-only list of answers, never stored. That is
 * what makes it safe across several phones: two people answering at the same
 * instant both land, order does not matter, a retry cannot double-count, and a
 * phone that was offline can post late without anything having to be merged.
 * It is also the shape the backend already stores (`PartyGameEvent`).
 *
 * The one rule worth stating out loud: **a team's answer is its first one.**
 * Otherwise four people on one team tap all four options and the team always
 * scores, which is not a quiz.
 */

import { QUIZ_QUESTIONS, type QuizQuestion } from '@/party/quiz/questions';

export interface QuizEntrant {
  /** One phone, one entrant. */
  id: string;
  /** Who they score for. Alone at a table, this is their own id. */
  teamId: string;
  /** Shown on the board. */
  teamName: string;
}

export interface QuizAnswer {
  entrantId: string;
  questionId: string;
  /** Index into that question's options. */
  option: number;
  /** Client stamp; only used to order answers within one team. */
  at: number;
}

export interface QuizStanding {
  teamId: string;
  teamName: string;
  score: number;
}

export interface QuizState {
  question: QuizQuestion | null;
  index: number;
  total: number;
  /** Teams that have committed an answer to the current question. */
  answered: string[];
  /** True once every team has answered — the moment to reveal. */
  complete: boolean;
  standings: QuizStanding[];
  finished: boolean;
}

/** The teams in play, in the order they first appear. */
export function teamsOf(entrants: QuizEntrant[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const entrant of entrants) {
    if (!seen.has(entrant.teamId)) seen.set(entrant.teamId, entrant.teamName);
  }
  return [...seen].map(([id, name]) => ({ id, name }));
}

/**
 * A team's answer to one question: the earliest one any of its members sent.
 *
 * Ties on the stamp fall back to the order the answers arrived, so the result is
 * the same on every phone replaying the same list.
 */
function teamAnswer(
  answers: QuizAnswer[],
  entrants: QuizEntrant[],
  teamId: string,
  questionId: string,
): QuizAnswer | null {
  const members = new Set(
    entrants.filter((entrant) => entrant.teamId === teamId).map((entrant) => entrant.id),
  );
  let best: QuizAnswer | null = null;
  for (const answer of answers) {
    if (answer.questionId !== questionId || !members.has(answer.entrantId)) continue;
    if (!best || answer.at < best.at) best = answer;
  }
  return best;
}

export function quizState({
  entrants,
  answers,
  index,
  questions = QUIZ_QUESTIONS,
}: {
  entrants: QuizEntrant[];
  answers: QuizAnswer[];
  /** Which question the room is on. Advanced by the host, never by a player. */
  index: number;
  questions?: readonly QuizQuestion[];
}): QuizState {
  const teams = teamsOf(entrants);
  const question = questions[index] ?? null;

  const standings: QuizStanding[] = teams
    .map((team) => ({
      teamId: team.id,
      teamName: team.name,
      score: questions.reduce((score, item) => {
        const answer = teamAnswer(answers, entrants, team.id, item.id);
        return answer && answer.option === item.answer ? score + 1 : score;
      }, 0),
    }))
    .sort((a, b) => b.score - a.score);

  const answered = question
    ? teams
        .filter((team) => teamAnswer(answers, entrants, team.id, question.id) !== null)
        .map((team) => team.id)
    : [];

  return {
    question,
    index,
    total: questions.length,
    answered,
    complete: teams.length > 0 && answered.length === teams.length,
    standings,
    finished: index >= questions.length,
  };
}

/** Whether this entrant's team has already committed — the UI locks on it. */
export function hasAnswered(
  answers: QuizAnswer[],
  entrants: QuizEntrant[],
  entrantId: string,
  questionId: string,
): boolean {
  const entrant = entrants.find((item) => item.id === entrantId);
  if (!entrant) return false;
  return teamAnswer(answers, entrants, entrant.teamId, questionId) !== null;
}

/**
 * The winner, or null when the top is shared.
 *
 * A tie is left as a tie: inventing a tie-break nobody agreed to is how a quiz
 * ends in an argument about the app rather than about the answers.
 */
export function quizWinner(standings: QuizStanding[]): string | null {
  if (standings.length === 0) return null;
  const top = standings[0];
  const shared = standings.filter((row) => row.score === top.score).length > 1;
  return shared || top.score === 0 ? null : top.teamId;
}
