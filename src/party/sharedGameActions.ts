/**
 * Pure folds for the interactions inside a shared party game.
 *
 * The backend deliberately stores an opaque `action` payload.  This module is
 * the game-side contract: every phone validates and folds the same cursor-
 * ordered list, while queued local actions are appended optimistically until
 * their `clientId` echo arrives.
 */

import type { PartyGameEvent, PartyGameEventInput } from '@/data/partyGamesClient';
import {
  recordRoll,
  settleRound,
  startDice,
  whoseTurn,
  type DicePlayer,
  type DiceState,
} from '@/games/web/dice/rules';

export type SharedGameActionPayload =
  | { type: 'prompt_next' }
  | { type: 'draw'; drawKind: 'person' | 'card'; value: string }
  | { type: 'pick'; playerId: string }
  | { type: 'dice_roll'; playerId: string; dice: [number, number] }
  | { type: 'dice_next' };

export type SharedGameAction = SharedGameActionPayload & { clientId: string };

export interface SharedGamePlayer extends DicePlayer {
  id: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function die(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 6;
}

/** Drop malformed or future actions; a bad row must never break the whole game. */
export function parseSharedGameAction(
  payload: unknown,
  clientId: string,
): SharedGameAction | null {
  const data = object(payload);
  if (!data || !clientId) return null;
  if (data.type === 'prompt_next' || data.type === 'dice_next') {
    return { type: data.type, clientId };
  }
  if (
    data.type === 'draw' &&
    (data.drawKind === 'person' || data.drawKind === 'card') &&
    typeof data.value === 'string' &&
    data.value.length > 0
  ) {
    return { type: 'draw', drawKind: data.drawKind, value: data.value, clientId };
  }
  if (data.type === 'pick' && typeof data.playerId === 'string' && data.playerId) {
    return { type: 'pick', playerId: data.playerId, clientId };
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
  return actions.reduce((count, action) => count + (action.type === 'prompt_next' ? 1 : 0), 0);
}

export function latestDraw(
  actions: readonly SharedGameAction[],
  kind: 'person' | 'card',
  validValues?: ReadonlySet<string>,
): Extract<SharedGameAction, { type: 'draw' }> | null {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (
      action.type === 'draw' &&
      action.drawKind === kind &&
      (!validValues || validValues.has(action.value))
    ) return action;
  }
  return null;
}

export function latestPick(
  actions: readonly SharedGameAction[],
  validPlayerIds?: ReadonlySet<string>,
): Extract<SharedGameAction, { type: 'pick' }> | null {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (
      action.type === 'pick' &&
      (!validPlayerIds || validPlayerIds.has(action.playerId))
    ) return action;
  }
  return null;
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
    if (!player || whoseTurn(state) !== player.name) continue;
    state = recordRoll(state, player.name, action.dice);
  }
  return state;
}
