/**
 * The game side of the bridge — every HTML game starts here.
 *
 * A game should never touch `ReactNativeWebView`, parse a query string or invent
 * a message shape. It calls `connect()`, gets the players and the theme, answers
 * commands, and reports results. Everything else — the envelope, the version
 * check, the browser harness — is this file's problem.
 *
 * The harness is the part that pays for itself daily: opened as a plain page
 * with no app on the other end, the SDK fabricates an `init`, draws a row of
 * buttons for the game's own commands and prints what comes back. Tuning the
 * feel of a throw costs a reload rather than a native rebuild, a simulator and
 * four screens of tapping.
 */

import {
  GAME_PROTOCOL_VERSION,
  type FromGame,
  type GamePlayer,
  type GameScore,
  type GameTheme,
  type ToGame,
} from '@/games/protocol';

interface Bridge {
  postMessage(message: string): void;
}

type CommandHandler = (name: string, payload?: unknown) => void;

export interface GameSession {
  players: GamePlayer[];
  theme: GameTheme;
  options: Record<string, unknown>;
  /** Whose turn it is, or null before the first `turn`. */
  currentPlayer(): GamePlayer | null;
  /** Mid-game news. The app decides what it means. */
  emit(name: string, payload?: unknown): void;
  /** Over. Scores are per player id; `winnerId` is null for drinking games. */
  finish(result: { scores: GameScore[]; winnerId: string | null; payingId?: string | null }): void;
  fail(message: string): void;
}

export interface GameDefinition {
  /** Commands this game understands, and what to call them in the harness. */
  commands: { name: string; label: string }[];
  /** Called once, after the app (or the harness) has sent `init`. */
  start(session: GameSession): CommandHandler;
}

const bridge = (window as unknown as { ReactNativeWebView?: Bridge }).ReactNativeWebView ?? null;
export const IN_APP = bridge !== null;

function send(message: FromGame): void {
  const text = JSON.stringify(message);
  if (bridge) {
    bridge.postMessage(text);
    return;
  }
  // eslint-disable-next-line no-console
  console.info('[game →]', text);
  harnessLog?.(message);
}

let harnessLog: ((message: FromGame) => void) | null = null;

/**
 * Stand in for the app when the page is opened directly.
 *
 * Two players in the app's own amber and green, the real palette, and a button
 * per command — so the harness exercises the same code path the app does rather
 * than a parallel one that can quietly diverge.
 */
function harnessInit(): ToGame {
  return {
    v: GAME_PROTOCOL_VERSION,
    type: 'init',
    players: [
      { id: 'p1', colour: '#E8A317' },
      { id: 'p2', colour: '#7DD66B' },
    ],
    theme: { bg: '#15120F', surface: '#1C1815', accent: '#E8A317', ink: '#FBF6EA' },
    options: Object.fromEntries(new URLSearchParams(window.location.search)),
  };
}

function buildHarness(definition: GameDefinition, dispatch: CommandHandler, turn: () => void): void {
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;display:flex;gap:10px;align-items:center;' +
    'justify-content:center;flex-wrap:wrap;padding:16px;' +
    'font:600 14px -apple-system,system-ui,sans-serif;';

  for (const command of definition.commands) {
    const button = document.createElement('button');
    button.textContent = command.label;
    button.style.cssText =
      'padding:13px 30px;border:0;border-radius:999px;background:#E8A317;color:#15120F;' +
      'font:800 16px -apple-system,system-ui,sans-serif;';
    button.onclick = () => dispatch(command.name);
    bar.appendChild(button);
  }

  const next = document.createElement('button');
  next.textContent = 'Další hráč';
  next.style.cssText =
    'padding:13px 22px;border:1px solid #4a4038;border-radius:999px;background:transparent;' +
    'color:#FBF6EA;font:600 14px -apple-system,system-ui,sans-serif;';
  next.onclick = turn;
  bar.appendChild(next);

  const readout = document.createElement('span');
  readout.style.cssText = 'color:#FBF6EA;opacity:.7;min-width:120px;';
  readout.textContent = '—';
  bar.appendChild(readout);

  harnessLog = (message) => {
    if (message.type === 'event') readout.textContent = JSON.stringify(message.payload);
    else if (message.type === 'result') readout.textContent = `konec: ${JSON.stringify(message.scores)}`;
    else if (message.type === 'error') readout.textContent = `chyba: ${message.message}`;
  };

  document.body.appendChild(bar);
}

/** Wire a game up. Call once, at the bottom of the game's entry file. */
export function connect(definition: GameDefinition): void {
  let players: GamePlayer[] = [];
  let theme: GameTheme = { bg: '#15120F', surface: '#1C1815', accent: '#E8A317', ink: '#FBF6EA' };
  let options: Record<string, unknown> = {};
  let currentId: string | null = null;
  let handle: CommandHandler | null = null;

  const session: GameSession = {
    get players() {
      return players;
    },
    get theme() {
      return theme;
    },
    get options() {
      return options;
    },
    currentPlayer: () => players.find((player) => player.id === currentId) ?? null,
    emit: (name, payload) => send({ v: GAME_PROTOCOL_VERSION, type: 'event', name, payload }),
    finish: (result) => send({ v: GAME_PROTOCOL_VERSION, type: 'result', ...result }),
    fail: (message) => send({ v: GAME_PROTOCOL_VERSION, type: 'error', message }),
  };

  const apply = (message: ToGame): void => {
    if (message.v !== GAME_PROTOCOL_VERSION) return;
    if (message.type === 'init') {
      players = message.players;
      theme = message.theme;
      options = message.options ?? {};
      currentId = players[0]?.id ?? null;
      handle = definition.start(session);
      return;
    }
    if (message.type === 'turn') {
      currentId = message.playerId;
      handle?.('__turn', message.playerId);
      return;
    }
    if (message.type === 'command') handle?.(message.name, message.payload);
  };

  // The app injects into this. One entry point, so the page has no other way in.
  (window as unknown as { napivoGame(raw: string): void }).napivoGame = (raw) => {
    try {
      apply(JSON.parse(raw) as ToGame);
    } catch {
      session.fail('Neplatná zpráva z aplikace.');
    }
  };

  send({ v: GAME_PROTOCOL_VERSION, type: 'ready' });

  if (!IN_APP) {
    apply(harnessInit());
    let index = 0;
    buildHarness(
      definition,
      (name, payload) => handle?.(name, payload),
      () => {
        index = (index + 1) % Math.max(1, players.length);
        apply({ v: GAME_PROTOCOL_VERSION, type: 'turn', playerId: players[index].id });
      },
    );
  }
}
