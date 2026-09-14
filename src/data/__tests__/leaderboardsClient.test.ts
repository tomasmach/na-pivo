import { ensureAccount } from '../account';
import {
  clearLeaderboardsCache,
  fetchLeaderboard,
  parseLeaderboard,
} from '../leaderboardsClient';

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
}));

jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const ORIGINAL_FETCH = global.fetch;

function account(accountId: string) {
  return {
    accountId,
    deviceId: `device-${accountId}`,
    token: `token-${accountId}`,
    authenticated: true,
  };
}

function boardPayload(score: number) {
  return {
    category: 'beers',
    period: 'week',
    entries: [
      {
        rank: 1,
        score,
        is_me: true,
        account: { id: `profile-${score}`, display_name: `Pivař ${score}` },
      },
    ],
    me: { rank: 1, score, listed: true, eligible: true },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearLeaderboardsCache();
  mockEnsureAccount.mockResolvedValue(account('account-a'));
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('parseLeaderboard', () => {
  it('parses a full payload', () => {
    const board = parseLeaderboard(
      {
        category: 'beers',
        period: 'week',
        period_start: '2026-07-06T00:00:00+02:00',
        total_ranked: 132,
        entries: [
          {
            rank: 1,
            score: 34,
            is_me: false,
            is_friend: true,
            account: {
              id: 'acc-1',
              nickname: 'pepa_z_depa',
              display_name: 'Pepa',
              avatar_url: 'https://example.test/a.jpg',
            },
          },
          {
            rank: 2,
            score: 30,
            is_me: true,
            account: { id: 'acc-2', nickname: null, display_name: '' },
          },
        ],
        me: { rank: 2, score: 30, listed: true, eligible: true },
      },
      'beers',
      'week',
    );

    expect(board.category).toBe('beers');
    expect(board.period).toBe('week');
    expect(board.periodStart).toBe('2026-07-06T00:00:00+02:00');
    expect(board.totalRanked).toBe(132);
    expect(board.entries).toHaveLength(2);
    expect(board.entries[0]).toEqual({
      rank: 1,
      score: 34,
      isMe: false,
      isFriend: true,
      account: {
        id: 'acc-1',
        nickname: 'pepa_z_depa',
        displayName: 'Pepa',
        avatarUrl: 'https://example.test/a.jpg',
      },
    });
    expect(board.entries[1].isMe).toBe(true);
    expect(board.entries[1].account.nickname).toBeNull();
    expect(board.me).toEqual({ rank: 2, score: 30, listed: true, eligible: true });
  });

  it('drops entries without an account id and defaults missing fields', () => {
    const board = parseLeaderboard(
      {
        entries: [{ rank: 1, score: 5, account: {} }, { rank: 2, score: 4, account: { id: 'x' } }],
      },
      'pubs',
      'year',
    );
    expect(board.category).toBe('pubs');
    expect(board.period).toBe('year');
    expect(board.periodStart).toBeNull();
    expect(board.totalRanked).toBe(0);
    expect(board.entries).toHaveLength(1);
    expect(board.entries[0].account.id).toBe('x');
    // Missing `me` still yields a usable object (private-safe defaults).
    expect(board.me).toEqual({ rank: null, score: 0, listed: false, eligible: true });
  });

  it('trusts the server echo when it coerces mapper to all-time', () => {
    const board = parseLeaderboard({ category: 'mapper', period: 'all' }, 'mapper', 'week');
    expect(board.period).toBe('all');
  });

  it('reports an ineligible (private) me', () => {
    const board = parseLeaderboard(
      { me: { rank: 47, score: 3, listed: false, eligible: false } },
      'beers',
      'week',
    );
    expect(board.me.rank).toBe(47);
    expect(board.me.listed).toBe(false);
    expect(board.me.eligible).toBe(false);
  });
});

describe('fetchLeaderboard account cache isolation', () => {
  it('never serves account A cache after switching to account B', async () => {
    let activeAccount = account('account-a');
    mockEnsureAccount.mockImplementation(async () => activeAccount);
    const fetchSpy = jest.fn(async (_url: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>).Authorization;
      const score = token === 'Bearer token-account-a' ? 11 : 22;
      return {
        ok: true,
        status: 200,
        json: async () => boardPayload(score),
      };
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    expect((await fetchLeaderboard('beers', 'week'))?.me.score).toBe(11);
    expect((await fetchLeaderboard('beers', 'week'))?.me.score).toBe(11);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    activeAccount = account('account-b');
    const boardB = await fetchLeaderboard('beers', 'week');

    expect(boardB?.me.score).toBe(22);
    expect(boardB?.entries[0].isMe).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('forces a fresh personalized board after account-boundary cleanup', async () => {
    let score = 11;
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => boardPayload(score),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    expect((await fetchLeaderboard('beers', 'week'))?.me.score).toBe(11);
    score = 22;
    expect((await fetchLeaderboard('beers', 'week'))?.me.score).toBe(11);

    clearLeaderboardsCache();

    expect((await fetchLeaderboard('beers', 'week'))?.me.score).toBe(22);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('clears cached identity fields at logout and invalidates an in-flight read', async () => {
    let resolveResponse: ((value: unknown) => void) | undefined;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    ) as unknown as typeof fetch;

    const pending = fetchLeaderboard('beers', 'week');
    await Promise.resolve();
    await Promise.resolve();
    clearLeaderboardsCache();
    resolveResponse?.({
      ok: true,
      status: 200,
      json: async () => boardPayload(99),
    });

    expect(await pending).toBeNull();
  });
});
