/**
 * Tests for the live subscription (src/data/partyGamesStream.ts).
 *
 * The frame parser is tested directly because chunk boundaries are where SSE
 * clients actually break — a frame arrives in halves far more often than whole.
 * The subscription itself is tested through a fake XHR, which is the only way to
 * assert the property the whole design rests on: a cursor is never emitted
 * twice, however the connection behaves.
 */

const fetchPartyGames: jest.Mock = jest.fn();
jest.mock('../partyGamesClient', () => ({
  fetchPartyGames: (...args: unknown[]) => fetchPartyGames(...(args as [])),
  parsePartyGameEvent: jest.requireActual('../partyGamesClient').parsePartyGameEvent,
}));
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 'tok', accountId: 'a' })),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `https://example.test${path}`,
}));

import { parseSseFrames, subscribeToPartyGames } from '../partyGamesStream';

describe('parseSseFrames', () => {
  it('reads a whole frame and keeps the half-frame for later', () => {
    const parsed = parseSseFrames('event: game_event\ndata: {"cursor":1}\n\nevent: game_ev');

    expect(parsed.frames).toEqual([{ event: 'game_event', data: '{"cursor":1}' }]);
    expect(parsed.rest).toBe('event: game_ev');
  });

  it('ignores a heartbeat comment', () => {
    const parsed = parseSseFrames(': beat\n\n');

    expect(parsed.frames).toEqual([]);
  });

  it('joins a frame that was split across two chunks', () => {
    const first = parseSseFrames('event: open\ndata: {"cur');
    const second = parseSseFrames(first.rest + 'sor":0}\n\n');

    expect(second.frames).toEqual([{ event: 'open', data: '{"cursor":0}' }]);
  });
});

/** A fake XHR that lets a test push chunks at the subscription. */
class FakeXhr {
  static last: FakeXhr | null = null;
  readyState = 0;
  status = 200;
  responseText = '';
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  aborted = false;

  constructor() {
    FakeXhr.last = this;
  }
  open() {}
  setRequestHeader() {}
  send() {
    this.readyState = 3;
  }
  abort() {
    this.aborted = true;
  }
  push(text: string) {
    this.responseText += text;
    this.readyState = 3;
    this.onreadystatechange?.();
  }
  end() {
    this.readyState = 4;
    this.onreadystatechange?.();
  }
}

function event(cursor: number, gameId = 'game-1') {
  return { cursor, game_id: gameId, kind: 'score', account: {}, delta: 1, at: '' };
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe('subscribeToPartyGames', () => {
  const realXhr = global.XMLHttpRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    FakeXhr.last = null;
    (global as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });

  afterEach(() => {
    (global as { XMLHttpRequest: unknown }).XMLHttpRequest = realXhr;
  });

  it('never hands the same cursor over twice', async () => {
    // The catch-up already carried cursor 7; the stream, which was opened with
    // an older `since`, replays it. Exactly the case a reconnect creates.
    fetchPartyGames.mockResolvedValue({
      ok: true,
      cursor: 7,
      games: [{ id: 'game-1', catalogKey: 'dice', name: 'Kostky' }],
      events: [{ ...event(7), cursor: 7 }].map((raw) =>
        jest.requireActual('../partyGamesClient').parsePartyGameEvent(raw),
      ),
    });
    const seen: number[] = [];
    const sub = subscribeToPartyGames('ABC123', {
      onEvents: (events) => seen.push(...events.map((item) => item.cursor)),
    });

    await flushMicrotasks();
    FakeXhr.last?.push(`event: game_event\ndata: ${JSON.stringify(event(7))}\n\n`);
    FakeXhr.last?.push(`event: game_event\ndata: ${JSON.stringify(event(8))}\n\n`);
    await flushMicrotasks();
    sub.close();

    expect(seen).toEqual([7, 8]);
  });

  it('ends the stream when a game it has never heard of turns up', async () => {
    fetchPartyGames.mockResolvedValue({ ok: true, cursor: 0, games: [], events: [] });
    const sub = subscribeToPartyGames('ABC123', { onEvents: () => {} });

    await flushMicrotasks();
    const stream = FakeXhr.last;
    stream?.push(`event: game_event\ndata: ${JSON.stringify(event(3, 'game-new'))}\n\n`);
    await flushMicrotasks();
    sub.close();

    // Closed without folding the event in: the next catch-up brings the game
    // down first, and then the same event.
    expect(stream?.aborted).toBe(true);
  });
});
