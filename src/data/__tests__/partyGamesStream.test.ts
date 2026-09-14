/**
 * Tests for the live subscription (src/data/partyGamesStream.ts).
 *
 * The frame parser is tested directly because chunk boundaries are where SSE
 * clients actually break — a frame arrives in halves far more often than whole.
 * The subscription itself is tested through a fake XHR, which is the only way to
 * assert the property the whole design rests on: a cursor is never emitted
 * twice, however the connection behaves.
 */

import { parseSseFrames, subscribeToPartyGames } from '../partyGamesStream';

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
  static instances: FakeXhr[] = [];
  readyState = 0;
  status = 200;
  responseText = '';
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  aborted = false;

  constructor() {
    FakeXhr.last = this;
    FakeXhr.instances.push(this);
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
  respond(status: number, body: string) {
    this.status = status;
    this.responseText = body;
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
    FakeXhr.instances = [];
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

  it('refreshes a known placed game when the first lobby binds its roster', async () => {
    const placed = {
      id: 'game-1',
      catalogKey: 'quiz',
      name: 'Pub kvíz',
      scoring: 'points',
      startedBy: { id: 'a', nickname: null, displayName: 'A', avatarUrl: null },
      roster: [],
      startedAt: '2026-08-21T12:00:00Z',
      endedAt: null,
      seed: 1,
    };
    const bound = {
      ...placed,
      roster: [
        placed.startedBy,
        { id: 'b', nickname: null, displayName: 'B', avatarUrl: null },
      ],
    };
    fetchPartyGames
      .mockResolvedValueOnce({ ok: true, cursor: 1, games: [placed], events: [] })
      .mockResolvedValueOnce({
        ok: true,
        cursor: 2,
        games: [bound],
        events: [
          jest.requireActual('../partyGamesClient').parsePartyGameEvent(event(2)),
        ],
      });
    const seenGames: (typeof placed)[] = [];
    const sub = subscribeToPartyGames('ABC123', {
      onGames: (games) => seenGames.push(...(games as (typeof placed)[])),
      onEvents: () => {},
    });

    await flushMicrotasks();
    const stream = FakeXhr.last;
    stream?.push(
      `event: game_event\ndata: ${JSON.stringify({ ...event(2), kind: 'start' })}\n\n`,
    );
    await flushMicrotasks();
    await flushMicrotasks();
    sub.close();

    expect(stream?.aborted).toBe(true);
    expect(seenGames).toEqual([placed, bound]);
  });

  it('falls back immediately to polling on stream_limit_reached without losing the cursor', async () => {
    const parseEvent = jest.requireActual('../partyGamesClient').parsePartyGameEvent;
    const cursor42Response = () => ({
      ok: true,
      cursor: 42,
      games: [],
      events: [parseEvent(event(42))],
    });
    fetchPartyGames
      .mockResolvedValueOnce({
        ok: true,
        cursor: 41,
        games: [{ id: 'game-1', catalogKey: 'dice', name: 'Kostky' }],
        events: [],
      })
      .mockImplementationOnce(async () => cursor42Response())
      .mockImplementation(async () => cursor42Response());

    const seen: number[] = [];
    let sub: ReturnType<typeof subscribeToPartyGames> | null = null;
    jest.useFakeTimers();
    try {
      sub = subscribeToPartyGames(
        'ABC123',
        { onEvents: (events) => seen.push(...events.map((item) => item.cursor)) },
        41,
      );

      await jest.advanceTimersByTimeAsync(0);
      expect(FakeXhr.instances).toHaveLength(1);
      FakeXhr.instances[0].respond(429, JSON.stringify({ code: 'stream_limit_reached' }));

      await jest.advanceTimersByTimeAsync(6000);
      await jest.advanceTimersByTimeAsync(0);

      expect(seen).toEqual([42]);
      expect(FakeXhr.instances).toHaveLength(1);
      expect(fetchPartyGames.mock.calls.map((call) => call[1])).toEqual([41, 41, 42]);

      sub.close();
      await jest.advanceTimersByTimeAsync(6000);
      await jest.advanceTimersByTimeAsync(0);

      expect(fetchPartyGames).toHaveBeenCalledTimes(3);
      expect(seen).toEqual([42]);
    } finally {
      sub?.close();
      jest.useRealTimers();
    }
  });

  it('does not emit after close while a polling catch-up is pending', async () => {
    const parseEvent = jest.requireActual('../partyGamesClient').parsePartyGameEvent;
    let resolvePending: ((value: {
      ok: boolean;
      cursor: number;
      games: unknown[];
      events: unknown[];
    }) => void) = () => {
      throw new Error("pending resolver was not installed");
    };
    fetchPartyGames
      .mockResolvedValueOnce({
        ok: true,
        cursor: 41,
        games: [{ id: 'game-1', catalogKey: 'dice', name: 'Kostky' }],
        events: [],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePending = resolve;
          }),
      );

    const seen: number[] = [];
    const sub = subscribeToPartyGames(
      'ABC123',
      { onEvents: (events) => seen.push(...events.map((item) => item.cursor)) },
      41,
    );
    try {
      await flushMicrotasks();
      const stream = FakeXhr.last;
      expect(stream).not.toBeNull();
      stream?.respond(429, JSON.stringify({ code: 'stream_limit_reached' }));
      await flushMicrotasks();

      // The 429 pushed us into polling mode; its first catch-up is in flight.
      expect(fetchPartyGames).toHaveBeenCalledTimes(2);

      sub.close();
      resolvePending({
        ok: true,
        cursor: 42,
        games: [],
        events: [parseEvent(event(42))],
      });
      await flushMicrotasks();
      await flushMicrotasks();

      expect(seen).toEqual([]);
      expect(fetchPartyGames).toHaveBeenCalledTimes(2);
      expect(FakeXhr.instances).toHaveLength(1);
    } finally {
      sub.close();
    }
  });
});
