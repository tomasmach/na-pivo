/**
 * The contract between the app and a game — the only thing both sides share.
 *
 * Games are HTML pages in a WebView (see `docs/design-system.md` §18.11b). The
 * app is the platform: it owns who is playing, whose turn it is, the score and
 * what the evening does with the result. A game owns a rectangle, and inside it
 * whatever it needs to be fun.
 *
 * This file is imported by BOTH sides — React Native and, through the esbuild
 * step, the page itself — so the two cannot drift. When a message shape changes
 * here, both ends fail to compile, which is the point.
 *
 * Three rules the shapes below are built to enforce:
 *
 *   1. **No names cross.** A player is an id and a colour. At a phone passed
 *      around a table, "those are Honza's dice" is read from the colour long
 *      before anyone reads a label — and text inside a canvas has no Dynamic
 *      Type, no VoiceOver and none of the app's typography. Anything with words
 *      in it belongs in React Native, layered over the game if it has to sit on
 *      top of it.
 *   2. **The game is the source of chance.** Results travel OUT. Nothing decides
 *      an outcome up front and animates towards it; a roll that was chosen
 *      before it was thrown is not a roll.
 *   3. **Every game ends by saying so.** A `result` is what the recap, the feed
 *      and the shared-game backend consume, so it is the same shape for all of
 *      them and never game-specific.
 */

/** Bumped only for a breaking change; both ends check it. */
export const GAME_PROTOCOL_VERSION = 1;

export interface GamePlayer {
  /** Stable within one game. The app maps it back to a person. */
  id: string;
  /** What this player's pieces look like. The only thing a game knows of them. */
  colour: string;
}

/** The app's palette, so a canvas never looks like a foreign web page. */
export interface GameTheme {
  bg: string;
  surface: string;
  accent: string;
  ink: string;
}

/** Platform → game. */
export type ToGame =
  | {
      v: typeof GAME_PROTOCOL_VERSION;
      type: 'init';
      players: GamePlayer[];
      theme: GameTheme;
      /** Whatever this particular game needs. Opaque to the layer. */
      options?: Record<string, unknown>;
    }
  /** Whose turn it is now — sent before every turn, never assumed by the game. */
  | { v: typeof GAME_PROTOCOL_VERSION; type: 'turn'; playerId: string }
  /** A verb the game declares. "roll", "spin", "draw". */
  | { v: typeof GAME_PROTOCOL_VERSION; type: 'command'; name: string; payload?: unknown };

/** One line of a final scoreboard. */
export interface GameScore {
  playerId: string;
  score: number;
}

/** Game → platform. */
export type FromGame =
  /** Loaded and listening. The app sends `init` only after this. */
  | { v: typeof GAME_PROTOCOL_VERSION; type: 'ready' }
  /**
   * Something happened worth reacting to, mid-game. The app decides what it
   * means — the game does not keep score.
   */
  | { v: typeof GAME_PROTOCOL_VERSION; type: 'event'; name: string; payload?: unknown }
  /** Over. This is what the recap and the feed lead with. */
  | {
      v: typeof GAME_PROTOCOL_VERSION;
      type: 'result';
      scores: GameScore[];
      /** Null for drinking games: they crown nobody, ever. */
      winnerId: string | null;
      /** Who is buying, when the game was about that. */
      payingId?: string | null;
    }
  | { v: typeof GAME_PROTOCOL_VERSION; type: 'error'; message: string };

/** Narrow an unknown frame off the wire. Anything malformed is dropped. */
export function parseFromGame(raw: string): FromGame | null {
  try {
    const value = JSON.parse(raw) as FromGame;
    if (value?.v !== GAME_PROTOCOL_VERSION) return null;
    if (
      value.type === 'ready' ||
      value.type === 'event' ||
      value.type === 'result' ||
      value.type === 'error'
    ) {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}
