/**
 * The contract between the app and a game — the only thing both sides share.
 *
 * Games are HTML pages in a WebView (see `DESIGN.md` §21.4). The
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

/**
 * The page has no locale and no strings file, so an `error` frame it raises by
 * itself carries a stable code rather than a sentence. The host translates it;
 * anything else in `message` is passed through as the game wrote it.
 */
export const GAME_ERROR_PROTOCOL_MISMATCH = 'protocol_mismatch';

export interface GamePlayer {
  /** Stable within one game. The app maps it back to a person. */
  id: string;
  /** What this player's pieces look like. */
  colour: string;
  /**
   * A short label to draw ON an object — a name on a wheel wedge, initials on a
   * counter. Optional, and games that do not need it must not use it.
   *
   * This is the one place words cross, and the distinction matters: a label
   * PAINTED ON a spinning object is part of the object, like the number on a
   * roulette pocket. UI text is not — the sentence that says who was chosen is
   * still drawn in React Native, where it has the app's type, Dynamic Type and
   * a voice. A canvas may decorate; it may not narrate.
   */
  label?: string;
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
   * The game's whole state, after every change.
   *
   * The game owns its rules and its progression; this is how the app draws the
   * words. Opaque to this layer — the host passes it straight through and the
   * screen that hosts a given game knows its shape — which is what lets all the
   * text stay in React Native while none of the logic does.
   *
   * A snapshot rather than a diff: a game that is rendered from a full state
   * cannot get out of step with one that missed a frame.
   */
  | { v: typeof GAME_PROTOCOL_VERSION; type: 'state'; state: unknown }
  /** Something worth a noise, mid-game. Never state — state has its own frame. */
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

/** Validate app → page frames too; injected JavaScript is still an untrusted boundary. */
export function parseToGame(raw: string): ToGame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (value.v !== GAME_PROTOCOL_VERSION) return null;
    if (value.type === 'command' && typeof value.name === 'string' && value.name.length > 0) {
      return { v: GAME_PROTOCOL_VERSION, type: 'command', name: value.name, payload: value.payload };
    }
    if (value.type === 'turn' && typeof value.playerId === 'string' && value.playerId.length > 0) {
      return { v: GAME_PROTOCOL_VERSION, type: 'turn', playerId: value.playerId };
    }
    if (value.type !== 'init' || !Array.isArray(value.players)) return null;
    const theme = value.theme;
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return null;
    const palette = theme as Record<string, unknown>;
    if (!['bg', 'surface', 'accent', 'ink'].every((key) => typeof palette[key] === 'string')) {
      return null;
    }
    if (!value.players.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const player = item as Record<string, unknown>;
      return typeof player.id === 'string' && player.id.length > 0 &&
        typeof player.colour === 'string' && player.colour.length > 0 &&
        (player.label === undefined || typeof player.label === 'string');
    })) return null;
    return {
      v: GAME_PROTOCOL_VERSION,
      type: 'init',
      players: value.players as GamePlayer[],
      theme: palette as unknown as GameTheme,
      ...(value.options && typeof value.options === 'object' && !Array.isArray(value.options)
        ? { options: value.options as Record<string, unknown> }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Narrow an unknown frame off the wire. Anything malformed is dropped. */
export function parseFromGame(raw: string): FromGame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (value.v !== GAME_PROTOCOL_VERSION || typeof value.type !== 'string') return null;
    if (value.type === 'ready') return { v: GAME_PROTOCOL_VERSION, type: 'ready' };
    if (value.type === 'state' && 'state' in value) {
      return { v: GAME_PROTOCOL_VERSION, type: 'state', state: value.state };
    }
    if (value.type === 'event' && typeof value.name === 'string' && value.name.length > 0) {
      return { v: GAME_PROTOCOL_VERSION, type: 'event', name: value.name, payload: value.payload };
    }
    if (value.type === 'error' && typeof value.message === 'string') {
      return { v: GAME_PROTOCOL_VERSION, type: 'error', message: value.message };
    }
    if (
      value.type === 'result' &&
      Array.isArray(value.scores) &&
      value.scores.every((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
        const score = row as Record<string, unknown>;
        return typeof score.playerId === 'string' && score.playerId.length > 0 &&
          Number.isFinite(score.score);
      }) &&
      ((typeof value.winnerId === 'string' && value.winnerId.length > 0) ||
        value.winnerId === null) &&
      (value.payingId === undefined || value.payingId === null ||
        (typeof value.payingId === 'string' && value.payingId.length > 0))
    ) {
      return {
        v: GAME_PROTOCOL_VERSION,
        type: 'result',
        scores: value.scores as GameScore[],
        winnerId: value.winnerId,
        ...(value.payingId !== undefined ? { payingId: value.payingId } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}
