/**
 * The live half: what the rest of the table just did, within about a second.
 *
 * `subscribeToPartyGames` is the only thing a screen needs. It hands back games
 * and events in cursor order and keeps doing so until you close it, whatever the
 * network does in between — it is a subscription, not a connection.
 *
 * Shape of it:
 *
 *   catch-up (GET)  →  stream (SSE)  →  connection ends  →  catch-up  →  …
 *
 * Every arrow carries the same cursor, so a dropped connection, a backgrounded
 * app, a server that bounds its streams at ten minutes and a phone in a cellar
 * are all one case: come back and ask what happened after N. Nothing is missed
 * and nothing is replayed — the subscription never emits a cursor twice.
 *
 * Two things are worth knowing before editing this:
 *
 * 1. **It is XMLHttpRequest, not EventSource or fetch.** React Native has no
 *    EventSource, and its `fetch` has no readable body — `await resp.text()`
 *    waits for the end of a response that is designed never to end. XHR is the
 *    one API in RN that hands over bytes as they arrive (`readyState === 3`,
 *    `responseText` grows), and unlike EventSource it can carry a bearer token.
 *
 * 2. **It falls back to polling.** A proxy that buffers turns a stream into a
 *    long silence; older infrastructure may not be running the ASGI worker the
 *    stream needs at all. After a couple of connections that never delivered a
 *    frame, this stops trying and polls the same catch-up endpoint instead. The
 *    table gets slower, not broken — and no screen has to know which mode it is
 *    in.
 */

import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import {
  fetchPartyGames,
  parsePartyGameEvent,
  type PartyGame,
  type PartyGameEvent,
} from './partyGamesClient';

/** How long a silent connection is allowed to be. The server beats every 15 s. */
const SILENCE_TIMEOUT_MS = 45000;
/** Between reconnects, so a server that is down is not hammered by a pub full of phones. */
const RETRY_MS = [1000, 2000, 5000, 10000];
/** Catch-up interval once we have given up on streaming. */
const POLL_MS = 6000;
/** Connections that delivered nothing before we stop trying to stream. */
const STREAM_STRIKES = 2;

export interface PartyGamesSubscription {
  close(): void;
}

export interface PartyGamesHandlers {
  /** Games we did not know about yet, including ones started by other people. */
  onGames?: (games: PartyGame[]) => void;
  /** Always in cursor order, never a repeat. */
  onEvents: (events: PartyGameEvent[]) => void;
  /** True while a stream is open; false while polling or reconnecting. */
  onLive?: (live: boolean) => void;
}

interface SseFrame {
  event: string;
  data: string;
}

/**
 * Split whatever has arrived into whole frames plus the leftover.
 *
 * SSE frames are separated by a blank line, and a chunk boundary lands wherever
 * TCP feels like it — half a frame is the normal case, not the edge case.
 */
export function parseSseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const part of parts) {
    let event = 'message';
    const data: string[] = [];
    for (const line of part.split('\n')) {
      // A line starting with ':' is a comment — that is what a heartbeat is.
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    }
    if (data.length > 0) frames.push({ event, data: data.join('\n') });
  }
  return { frames, rest };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onAbort);
  });
}

/** Why a stream stopped — the loop only cares whether it was worth it. */
type StreamOutcome = 'delivered' | 'empty';

/**
 * Hold one stream open until it ends, feeding frames out as they arrive.
 *
 * Resolves `delivered` if the server ever spoke to us (so streaming works here),
 * `empty` if the connection came and went without a single frame (so it may
 * well not).
 */
function openStream(
  url: string,
  token: string,
  onFrame: (frame: SseFrame) => void,
  signal: AbortSignal,
): Promise<StreamOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let offset = 0;
    let buffer = '';
    let spoke = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const finish = (outcome: StreamOutcome) => {
      if (watchdog) clearTimeout(watchdog);
      signal.removeEventListener('abort', onAbort);
      try {
        xhr.abort();
      } catch {
        // Already finished; nothing to abort.
      }
      resolve(outcome);
    };
    function onAbort() {
      finish(spoke ? 'delivered' : 'empty');
    }
    const touch = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => finish(spoke ? 'delivered' : 'empty'), SILENCE_TIMEOUT_MS);
    };

    signal.addEventListener('abort', onAbort);
    xhr.onreadystatechange = () => {
      // 3 = LOADING: some of the body is here. This is the whole reason for XHR.
      if (xhr.readyState !== 3 && xhr.readyState !== 4) return;
      if (xhr.readyState === 3 && xhr.status !== 200) return;
      const chunk = xhr.responseText.slice(offset);
      offset = xhr.responseText.length;
      if (chunk) {
        touch();
        const parsed = parseSseFrames(buffer + chunk);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          spoke = true;
          onFrame(frame);
        }
      }
      if (xhr.readyState === 4) finish(spoke ? 'delivered' : 'empty');
    };
    xhr.onerror = () => finish(spoke ? 'delivered' : 'empty');
    xhr.ontimeout = () => finish(spoke ? 'delivered' : 'empty');

    try {
      xhr.open('GET', url);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.send();
      touch();
    } catch {
      finish('empty');
    }
  });
}

/**
 * Follow one evening's games until closed.
 *
 * `since` is where to resume from — pass the highest cursor already folded in,
 * or 0 for a cold start, which also brings down the games themselves.
 */
export function subscribeToPartyGames(
  code: string,
  handlers: PartyGamesHandlers,
  since = 0,
): PartyGamesSubscription {
  const controller = new AbortController();
  const { signal } = controller;
  let cursor = since;
  const knownGames = new Set<string>();

  const emitGames = (games: PartyGame[]) => {
    const fresh = games.filter((game) => !knownGames.has(game.id));
    for (const game of fresh) knownGames.add(game.id);
    if (fresh.length > 0) handlers.onGames?.(fresh);
  };

  const catchUp = async (): Promise<boolean> => {
    const res = await fetchPartyGames(code, cursor, signal);
    if (!res.ok) return false;
    emitGames(res.games);
    const fresh = res.events.filter((event) => event.cursor > cursor);
    if (fresh.length > 0) {
      cursor = fresh[fresh.length - 1].cursor;
      handlers.onEvents(fresh);
    } else if (res.cursor > cursor) {
      cursor = res.cursor;
    }
    return true;
  };

  const run = async () => {
    let strikes = 0;
    let attempt = 0;

    while (!signal.aborted) {
      const caughtUp = await catchUp();
      if (signal.aborted) break;
      if (!caughtUp) {
        await sleep(RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)], signal);
        continue;
      }
      attempt = 0;

      if (strikes >= STREAM_STRIKES) {
        // Streaming does not work here. Keep the table updated the slow way.
        await sleep(POLL_MS, signal);
        continue;
      }

      const session = await ensureAccount(signal);
      const url = getBackendEndpoint(
        `/v1/party-evenings/${encodeURIComponent(code)}/games/stream?since=${cursor}`,
      );
      if (!session || !url) {
        await sleep(RETRY_MS[0], signal);
        continue;
      }

      // A stream only carries events, never the games themselves. So a game
      // somebody else just started shows up here as an event for an id we do
      // not know — and the fix is to end the stream without folding it in. The
      // loop's next catch-up returns that game (the server sends games with
      // events after `since`) and then the same event, in that order.
      let unknownGame = false;
      const connection = new AbortController();
      const closeWithSubscription = () => connection.abort();
      signal.addEventListener('abort', closeWithSubscription);

      handlers.onLive?.(true);
      const outcome = await openStream(
        url,
        session.token,
        (frame) => {
          if (frame.event !== 'game_event') return;
          try {
            const event = parsePartyGameEvent(JSON.parse(frame.data));
            if (event.cursor <= cursor) return;
            if (!knownGames.has(event.gameId)) {
              unknownGame = true;
              connection.abort();
              return;
            }
            cursor = event.cursor;
            handlers.onEvents([event]);
          } catch {
            // A frame we cannot read is a frame we skip; the cursor has not
            // moved, so the next catch-up brings it back.
          }
        },
        connection.signal,
      );
      signal.removeEventListener('abort', closeWithSubscription);
      handlers.onLive?.(false);
      strikes = outcome === 'delivered' ? 0 : strikes + 1;
      if (!signal.aborted && !unknownGame && outcome === 'empty') {
        await sleep(RETRY_MS[Math.min(strikes - 1, RETRY_MS.length - 1)], signal);
      }
    }
  };

  void run();

  return {
    close: () => controller.abort(),
  };
}
