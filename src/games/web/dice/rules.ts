/**
 * Kostky, as a game with an ending — the rules, with no React in them.
 *
 * These live WITH the game, not with the app: a game that computes its own
 * progression is one thing to read and one thing to change, and the platform
 * stays a host that knows nothing about dice. The page runs them; the app
 * imports the same module only for the case where there is no canvas at all
 * (reduced motion, or a build without the WebView), so there is one set of
 * rules and never two that drift.
 *
 * Rounds. Everyone still in rolls once, in order. The highest roll takes the
 * round. Three rounds and you are SAFE: you sit out the rest and you are not
 * paying. Keep going until one player is left, and that one buys the round.
 *
 * Why safe-and-out rather than points-forever: a scoreboard that only grows has
 * no ending, so somebody has to decide to stop, and nobody at a table wants to
 * be the one who says "ok that's enough". Taking winners OUT means the game gets
 * faster as it goes and finishes itself. It also means the tension goes UP —
 * the last two are playing for the bill.
 *
 * A tie for the top is not resolved: everyone tied takes the round. Rolling off
 * a tie is a rule you have to explain, and this game has to be explainable in
 * one sentence to somebody who arrived late.
 *
 * Pure functions and plain data, so the rules are testable without rendering
 * anything — a game whose ending is wrong is worse than no game.
 */

export interface DicePlayer {
  name: string;
  tint: string;
}

export interface DiceRoll {
  name: string;
  /** Two dice, as thrown. */
  dice: [number, number];
}

export interface DiceState {
  players: DicePlayer[];
  /** Still playing, in turn order. */
  live: string[];
  /** Reached the target and is out of danger, in the order they got there. */
  safe: string[];
  /** Round wins per player. Reset for nobody; this is the whole ladder. */
  wins: Record<string, number>;
  /** Rolls in the CURRENT round, in the order they were thrown. */
  round: DiceRoll[];
  roundNumber: number;
  /** Set once the game is over. The one left holding the bill. */
  paying: string | null;
}

/** Three round wins and you are out of danger. */
export const TARGET_WINS = 3;

export function startDice(players: DicePlayer[]): DiceState {
  return {
    players,
    live: players.map((player) => player.name),
    safe: [],
    wins: Object.fromEntries(players.map((player) => [player.name, 0])),
    round: [],
    roundNumber: 1,
    paying: null,
  };
}

/** Whose turn it is, or null when the round is complete. */
export function whoseTurn(state: DiceState): string | null {
  const thrown = new Set(state.round.map((roll) => roll.name));
  return state.live.find((name) => !thrown.has(name)) ?? null;
}

export function total(roll: DiceRoll): number {
  return roll.dice[0] + roll.dice[1];
}

/** Everyone who tied for the highest roll this round. */
export function roundWinners(state: DiceState): string[] {
  if (state.round.length === 0) return [];
  const best = Math.max(...state.round.map(total));
  return state.round.filter((roll) => total(roll) === best).map((roll) => roll.name);
}

/** The lowest roll of the round — the one the table teases. */
export function roundLoser(state: DiceState): string | null {
  if (state.round.length === 0) return null;
  const worst = Math.min(...state.round.map(total));
  return state.round.find((roll) => total(roll) === worst)?.name ?? null;
}

export function recordRoll(state: DiceState, name: string, dice: [number, number]): DiceState {
  if (state.paying) return state;
  return { ...state, round: [...state.round, { name, dice }] };
}

/**
 * Close the round: hand out the wins, retire whoever got safe, and decide
 * whether anyone is left to play for.
 */
export function settleRound(state: DiceState): DiceState {
  if (state.round.length === 0 || whoseTurn(state) !== null) return state;

  const wins = { ...state.wins };
  for (const name of roundWinners(state)) wins[name] = (wins[name] ?? 0) + 1;

  const newlySafe = state.live.filter(
    (name) => wins[name] >= TARGET_WINS && !state.safe.includes(name),
  );
  const safe = [...state.safe, ...newlySafe];
  const live = state.live.filter((name) => !safe.includes(name));

  // One left and they are paying. Nobody left — everybody got there in the same
  // round — and the game ends with no bill, which is a fine way for it to end.
  const paying = live.length === 1 ? live[0] : live.length === 0 ? null : null;

  return {
    ...state,
    wins,
    safe,
    live,
    round: [],
    roundNumber: state.roundNumber + 1,
    paying,
    // `paying` alone cannot say "finished", because a game can end with nobody
    // paying; `live.length <= 1` is the real end condition.
  };
}

export function isOver(state: DiceState): boolean {
  return state.live.length <= 1 && state.roundNumber > 1;
}

/** The board, best first — what the recap and the feed get. */
export function standings(state: DiceState): { name: string; score: number }[] {
  return state.players
    .map((player) => ({ name: player.name, score: state.wins[player.name] ?? 0 }))
    .sort((a, b) => b.score - a.score);
}
