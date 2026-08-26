/**
 * Pure folds for the interactions inside a shared party game.
 *
 * The backend deliberately stores an opaque `action` payload.  This module is
 * the game-side contract: every phone validates and folds the same cursor-
 * ordered list, while queued local actions are appended optimistically until
 * their `clientId` echo arrives.
 */

import type { PartyGameEvent, PartyGameEventInput } from '@/data/partyGamesClient';
import { NOBODY_NAME } from '@/party/nightBuilder';
import {
  recordRoll,
  settleRound,
  startDice,
  whoseTurn,
  type DicePlayer,
  type DiceState,
} from '@/games/web/dice/rules';

export type SharedGameActionPayload =
  | { type: 'prompt_next'; fromStep?: number }
  | {
      type: 'draw'; drawKind: 'person' | 'card'; value: string;
      fromCount?: number; drawnById?: string;
    }
  | { type: 'pick'; playerId: string; fromRevision?: number }
  | { type: 'quiz_reveal'; question: number }
  | { type: 'quiz_next'; fromQuestion: number }
  | { type: 'dice_roll'; playerId: string; dice: [number, number] }
  | { type: 'dice_next' };

export type SharedGameAction = SharedGameActionPayload & { clientId: string };

export interface SharedGamePlayer extends DicePlayer {
  name: string;
}

export interface CanonicalGameFinish {
  winnerId: string | null;
  payingId: string | null;
  /** Legacy released clients stored display names only. */
  winner: string | null;
  paying: string | null;
  scores: { name: string; score: number; playerId?: string }[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function die(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6;
}

/** First valid finish wins on every client, even against a permissive old backend. */
export function canonicalGameFinish(
  events: readonly PartyGameEvent[],
): CanonicalGameFinish | null {
  const ordered = [...events].sort((left, right) => left.cursor - right.cursor);
  for (const event of ordered) {
    if (event.kind !== 'finish') continue;
    const payload = object(event.payload);
    if (!payload) continue;
    const scores = Array.isArray(payload.scores)
      ? payload.scores.flatMap((value) => {
          const row = object(value);
          if (!row || typeof row.name !== 'string' || !Number.isFinite(row.score)) return [];
          return [{
            name: row.name,
            score: Number(row.score),
            ...(typeof row.playerId === 'string' ? { playerId: row.playerId } : {}),
          }];
        })
      : [];
    const safeName = (value: unknown) =>
      typeof value === 'string' && value.trim() && value !== NOBODY_NAME ? value : null;
    return {
      winnerId: safeName(payload.winnerId),
      payingId: safeName(payload.payingId),
      winner: safeName(payload.winner),
      paying: safeName(payload.paying),
      scores,
    };
  }
  return null;
}

/** Drop malformed or future actions; a bad row must never break the whole game. */
export function parseSharedGameAction(
  payload: unknown,
  clientId: string,
): SharedGameAction | null {
  const data = object(payload);
  if (!data || !clientId) return null;
  if (data.type === 'prompt_next') {
    return {
      type: data.type,
      clientId,
      ...(Number.isSafeInteger(data.fromStep) && Number(data.fromStep) >= 0
        ? { fromStep: Number(data.fromStep) }
        : {}),
    };
  }
  if (data.type === 'dice_next') {
    return { type: data.type, clientId };
  }
  if (
    data.type === 'quiz_reveal' &&
    Number.isSafeInteger(data.question) &&
    Number(data.question) >= 0
  ) {
    return { type: data.type, question: Number(data.question), clientId };
  }
  if (
    data.type === 'quiz_next' &&
    Number.isSafeInteger(data.fromQuestion) &&
    Number(data.fromQuestion) >= 0
  ) {
    return { type: data.type, fromQuestion: Number(data.fromQuestion), clientId };
  }
  if (
    data.type === 'draw' &&
    (data.drawKind === 'person' || data.drawKind === 'card') &&
    typeof data.value === 'string' &&
    data.value.length > 0
  ) {
    return {
      type: 'draw', drawKind: data.drawKind, value: data.value, clientId,
      ...(Number.isSafeInteger(data.fromCount) && Number(data.fromCount) >= 0
        ? { fromCount: Number(data.fromCount) }
        : {}),
      ...(typeof data.drawnById === 'string' && data.drawnById
        ? { drawnById: data.drawnById }
        : {}),
    };
  }
  if (data.type === 'pick' && typeof data.playerId === 'string' && data.playerId) {
    return {
      type: 'pick', playerId: data.playerId, clientId,
      ...(Number.isSafeInteger(data.fromRevision) && Number(data.fromRevision) >= 0
        ? { fromRevision: Number(data.fromRevision) }
        : {}),
    };
  }
  if (
    data.type === 'dice_roll' &&
    typeof data.playerId === 'string' &&
    data.playerId &&
    Array.isArray(data.dice) &&
    data.dice.length === 2 &&
    die(data.dice[0]) &&
    die(data.dice[1])
  ) {
    return {
      type: 'dice_roll',
      playerId: data.playerId,
      dice: [data.dice[0], data.dice[1]],
      clientId,
    };
  }
  return null;
}

/**
 * Server order first, then still-queued local actions.  Echoes are replaced by
 * `clientId`, never by payload equality: two people can legitimately make the
 * same move at the same instant and both moves must land.
 */
export function foldSharedGameActions(
  events: readonly PartyGameEvent[],
  pending: readonly PartyGameEventInput[] = [],
): SharedGameAction[] {
  const actions: SharedGameAction[] = [];
  const seen = new Set<string>();
  const seenLegacyCursors = new Set<number>();

  for (const event of events) {
    if (event.kind !== 'action') continue;
    if (event.clientId) {
      if (seen.has(event.clientId)) continue;
      seen.add(event.clientId);
    } else if (event.cursor > 0) {
      if (seenLegacyCursors.has(event.cursor)) continue;
      seenLegacyCursors.add(event.cursor);
    }
    const action = parseSharedGameAction(event.payload, event.clientId ?? `cursor:${event.cursor}`);
    if (action) actions.push(action);
  }

  for (const event of pending) {
    if (event.kind !== 'action' || seen.has(event.clientId)) continue;
    seen.add(event.clientId);
    const action = parseSharedGameAction(event.payload, event.clientId);
    if (action) actions.push(action);
  }
  return actions;
}

export function promptStep(actions: readonly SharedGameAction[]): number {
  return actions.reduce((count, action) => {
    if (action.type !== 'prompt_next') return count;
    return action.fromStep === undefined || action.fromStep === count ? count + 1 : count;
  }, 0);
}

export function quizProgress(actions: readonly SharedGameAction[]): {
  question: number;
  forceRevealed: boolean;
} {
  let question = 0;
  const forced = new Set<number>();
  for (const action of actions) {
    if (action.type === 'quiz_reveal' && action.question === question) {
      forced.add(question);
    } else if (action.type === 'quiz_next' && action.fromQuestion === question) {
      question += 1;
    }
  }
  return { question, forceRevealed: forced.has(question) };
}

function canonicalDraws(
  actions: readonly SharedGameAction[],
  kind: 'person' | 'card',
  validValues?: ReadonlySet<string>,
): Extract<SharedGameAction, { type: 'draw' }>[] {
  const draws: Extract<SharedGameAction, { type: 'draw' }>[] = [];
  const physicalCards = new Set<string>();
  for (const action of actions) {
    if (action.type !== 'draw' || action.drawKind !== kind) continue;
    if (validValues && !validValues.has(action.value)) continue;
    if (action.fromCount !== undefined && action.fromCount !== draws.length) continue;
    if (kind === 'card' && action.value.includes('-') && physicalCards.has(action.value)) continue;
    draws.push(action);
    if (kind === 'card' && action.value.includes('-')) physicalCards.add(action.value);
  }
  return draws;
}

export function cardDraws(
  actions: readonly SharedGameAction[],
  validValues?: ReadonlySet<string>,
): string[] {
  return canonicalDraws(actions, 'card', validValues).map((action) => action.value);
}

/** Canonical card actions with their author, used when the draw itself pays. */
export function cardDrawActions(
  actions: readonly SharedGameAction[],
  validValues?: ReadonlySet<string>,
): readonly Extract<SharedGameAction, { type: 'draw' }>[] {
  return canonicalDraws(actions, 'card', validValues);
}

export function latestDraw(
  actions: readonly SharedGameAction[],
  kind: 'person' | 'card',
  validValues?: ReadonlySet<string>,
): Extract<SharedGameAction, { type: 'draw' }> | null {
  return canonicalDraws(actions, kind, validValues).at(-1) ?? null;
}

export function latestPick(
  actions: readonly SharedGameAction[],
  validPlayerIds?: ReadonlySet<string>,
): Extract<SharedGameAction, { type: 'pick' }> | null {
  let revision = 0;
  let latest: Extract<SharedGameAction, { type: 'pick' }> | null = null;
  for (const action of actions) {
    if (action.type !== 'pick' || (validPlayerIds && !validPlayerIds.has(action.playerId))) continue;
    if (action.fromRevision !== undefined && action.fromRevision !== revision) continue;
    latest = action;
    revision += 1;
  }
  return latest;
}

export function pickRevision(
  actions: readonly SharedGameAction[],
  validPlayerIds?: ReadonlySet<string>,
): number {
  let revision = 0;
  for (const action of actions) {
    if (action.type !== 'pick' || (validPlayerIds && !validPlayerIds.has(action.playerId))) continue;
    if (action.fromRevision !== undefined && action.fromRevision !== revision) continue;
    revision += 1;
  }
  return revision;
}

/** Fold dice from results, not new randomness. Invalid/out-of-turn rows are inert. */
export function foldDiceActions(
  players: readonly SharedGamePlayer[],
  actions: readonly SharedGameAction[],
): DiceState {
  let state = startDice([...players]);
  for (const action of actions) {
    if (action.type === 'dice_next') {
      state = settleRound(state);
      continue;
    }
    if (action.type !== 'dice_roll') continue;
    const player = players.find((candidate) => candidate.id === action.playerId);
    if (!player || whoseTurn(state) !== player.id) continue;
    state = recordRoll(state, player.id, action.dice);
  }
  return state;
}
