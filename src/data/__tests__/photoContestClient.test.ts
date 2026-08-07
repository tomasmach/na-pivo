/**
 * Tests for the photo-contest client (src/data/photoContestClient.ts) — the
 * data/logic layer only. Collaborators are mocked (backendConfig / account /
 * telemetry) and global fetch is stubbed per test.
 *
 * Focus: the GET snapshot mapping (contest, entries with my_vote/is_mine,
 * my_* ids, last_results incl. null), the hard-reject contract of the
 * online-only mutations (nickname_required, cannot_vote_own), and the vote
 * reconciliation payload ({entry_id, votes}).
 */

import {
  clearPhotoContestCache,
  clearPhotoContestVote,
  enterPhotoContest,
  fetchPhotoContest,
  fetchPhotoContestTeaser,
  votePhotoContest,
  withdrawPhotoContestEntry,
} from '@/data/photoContestClient';
import { ensureAccount } from '@/data/account';
import { getBackendEndpoint } from '@/data/backendConfig';

jest.mock('@/data/backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
  getBackendUrl: jest.fn(() => 'https://api.test'),
}));

jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'cur-tok',
    authenticated: false,
  })),
  clearCachedAnonymousAccount: jest.fn(),
}));

jest.mock('@/data/telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const mockGetBackendEndpoint = getBackendEndpoint as jest.MockedFunction<typeof getBackendEndpoint>;
const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const ORIGINAL_FETCH = global.fetch;

/** Resolve global.fetch like the WinterCG fetch: text() then JSON.parse. */
function fetchResolving(status: number, body: unknown): jest.Mock {
  const spy = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }));
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

const WIRE_CONTEST = {
  id: 'contest-7',
  period_start: '2026-06-29T00:00:00.000Z',
  period_end: '2026-07-13T00:00:00.000Z',
  status: 'open',
};

const WIRE_ENTRY = {
  id: 'e1',
  account: {
    public_id: 'pub-1',
    nickname: 'jarda',
    display_name: 'Jarda',
    avatar_url: 'https://cdn.test/a.jpg',
  },
  image_url: '/media/beer-photos/p1.jpg',
  caption: 'Zlatá pěna',
  pub_name: 'U Palmy',
  pub_city: 'Brno',
  votes: 12,
  my_vote: true,
  is_mine: false,
  created_at: '2026-07-01T19:00:00.000Z',
};

const APP_ENTRY = {
  id: 'e1',
  // Additive photo pin for content reports; the wire fixture omits `photo_id`.
  photoId: null,
  account: {
    id: 'pub-1',
    nickname: 'jarda',
    displayName: 'Jarda',
    avatarUrl: 'https://cdn.test/a.jpg',
    isPublic: true,
  },
  imageUrl: 'https://api.test/media/beer-photos/p1.jpg',
  caption: 'Zlatá pěna',
  pubName: 'U Palmy',
  pubCity: 'Brno',
  votes: 12,
  myVote: true,
  isMine: false,
  createdAt: '2026-07-01T19:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  clearPhotoContestCache();
  mockEnsureAccount.mockResolvedValue({
    deviceId: 'd',
    accountId: 'a',
    token: 'cur-tok',
    authenticated: false,
  });
  mockGetBackendEndpoint.mockImplementation((path: string) => `https://api.test${path}`);
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('fetchPhotoContest', () => {
  it('maps the full snapshot: contest, entries, my_* ids and last_results', async () => {
    const spy = fetchResolving(200, {
      contest: WIRE_CONTEST,
      entries: [WIRE_ENTRY],
      my_entry_id: 'e9',
      my_entry_photo_id: 'p9',
      my_vote_entry_id: 'e1',
      last_results: {
        contest: { ...WIRE_CONTEST, id: 'contest-6', status: 'closed' },
        winners: [
          {
            rank: 1,
            account: { public_id: 'pub-2', nickname: 'lucka', display_name: 'Lucka' },
            image_url: 'https://cdn.test/w.jpg',
            caption: 'Vítězná',
            votes: 30,
          },
        ],
        my_result: {
          entered: true,
          voted: true,
          rank: 1,
          votes: 30,
          xp_awarded: 100,
          wins_count: 2,
        },
      },
    });

    const snapshot = await fetchPhotoContest();

    expect(snapshot).toEqual({
      viewerAccountId: 'a',
      contest: {
        id: 'contest-7',
        periodStart: '2026-06-29T00:00:00.000Z',
        periodEnd: '2026-07-13T00:00:00.000Z',
        status: 'open',
      },
      entries: [APP_ENTRY],
      myEntryId: 'e9',
      myVoteEntryId: 'e1',
      lastResults: {
        contest: {
          id: 'contest-6',
          periodStart: '2026-06-29T00:00:00.000Z',
          periodEnd: '2026-07-13T00:00:00.000Z',
          status: 'closed',
        },
        winners: [
          {
            rank: 1,
            account: {
              id: 'pub-2',
              nickname: 'lucka',
              displayName: 'Lucka',
              avatarUrl: null,
              isPublic: true,
            },
            imageUrl: 'https://cdn.test/w.jpg',
            caption: 'Vítězná',
            votes: 30,
          },
        ],
        myResult: {
          entered: true,
          voted: true,
          rank: 1,
          votes: 30,
          xpAwarded: 100,
          winsCount: 2,
        },
      },
    });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/photo-contest');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cur-tok');
  });

  it('tolerates a minimal body (no contest, no results, null ids)', async () => {
    fetchResolving(200, { entries: [], my_entry_id: null, last_results: null });

    expect(await fetchPhotoContest()).toEqual({
      viewerAccountId: 'a',
      contest: null,
      entries: [],
      myEntryId: null,
      myVoteEntryId: null,
      lastResults: null,
    });
  });

  it('returns null on HTTP failure and when offline', async () => {
    fetchResolving(500, { detail: 'boom' });
    expect(await fetchPhotoContest()).toBeNull();

    mockGetBackendEndpoint.mockReturnValue(null);
    expect(await fetchPhotoContest()).toBeNull();
  });

  it('keeps personalized teaser snapshots strictly account-scoped', async () => {
    let accountId = 'account-a';
    mockEnsureAccount.mockImplementation(async () => ({
      deviceId: `device-${accountId}`,
      accountId,
      token: `token-${accountId}`,
      authenticated: true,
    }));
    const fetchSpy = jest.fn(async (_url: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>).Authorization;
      const ownId = token === 'Bearer token-account-a' ? 'entry-a' : 'entry-b';
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            entries: [],
            my_entry_id: ownId,
            my_vote_entry_id: `vote-${ownId}`,
            last_results: {
              contest: WIRE_CONTEST,
              winners: [],
              my_result: { entered: true, rank: ownId === 'entry-a' ? 1 : 2 },
            },
          }),
      };
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    expect((await fetchPhotoContestTeaser())?.myEntryId).toBe('entry-a');
    expect((await fetchPhotoContestTeaser())?.lastResults?.myResult?.rank).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    accountId = 'account-b';
    const snapshotB = await fetchPhotoContestTeaser();

    expect(snapshotB?.myEntryId).toBe('entry-b');
    expect(snapshotB?.myVoteEntryId).toBe('vote-entry-b');
    expect(snapshotB?.lastResults?.myResult?.rank).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('forces a fresh personalized teaser after account-boundary cleanup', async () => {
    let ownId = 'entry-a';
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ entries: [], my_entry_id: ownId }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    expect((await fetchPhotoContestTeaser())?.myEntryId).toBe('entry-a');
    ownId = 'entry-b';
    expect((await fetchPhotoContestTeaser())?.myEntryId).toBe('entry-a');

    clearPhotoContestCache();

    expect((await fetchPhotoContestTeaser())?.myEntryId).toBe('entry-b');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('drops personalized teaser state and in-flight responses at logout', async () => {
    let resolveResponse: ((value: unknown) => void) | undefined;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    ) as unknown as typeof fetch;

    const pending = fetchPhotoContestTeaser();
    await Promise.resolve();
    await Promise.resolve();
    clearPhotoContestCache();
    resolveResponse?.({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ entries: [], my_entry_id: 'old-entry' }),
    });

    expect(await pending).toBeNull();
  });
});

describe('enterPhotoContest', () => {
  it('POSTs {photo_id} and returns the created entry', async () => {
    const spy = fetchResolving(201, { entry: WIRE_ENTRY });

    const result = await enterPhotoContest('p1');

    expect(result).toEqual({ ok: true, entry: APP_ENTRY });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/photo-contest/entries');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ photo_id: 'p1' });
  });

  it('hard-rejects with nickname_required so the UI can revert', async () => {
    fetchResolving(400, { detail: 'Nejdřív přezdívku.', code: 'nickname_required' });

    expect(await enterPhotoContest('p1')).toEqual({
      ok: false,
      code: 'nickname_required',
      detail: 'Nejdřív přezdívku.',
    });
  });
});

describe('withdrawPhotoContestEntry', () => {
  it('DELETEs the entry and returns ok on 204', async () => {
    const spy = fetchResolving(204, undefined);

    expect(await withdrawPhotoContestEntry()).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/photo-contest/entries');
    expect(init.method).toBe('DELETE');
  });
});

describe('votePhotoContest', () => {
  it('POSTs {entry_id} and returns the fresh vote count for reconciliation', async () => {
    const spy = fetchResolving(200, { entry_id: 'e1', votes: 13 });

    const result = await votePhotoContest('e1');

    expect(result).toEqual({ ok: true, entryId: 'e1', votes: 13 });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/photo-contest/vote');
    expect(JSON.parse(init.body as string)).toEqual({ entry_id: 'e1' });
  });

  it('hard-rejects with cannot_vote_own so the UI can revert', async () => {
    fetchResolving(400, { detail: 'Vlastní fotce ne.', code: 'cannot_vote_own' });

    expect(await votePhotoContest('e1')).toEqual({
      ok: false,
      code: 'cannot_vote_own',
      detail: 'Vlastní fotce ne.',
    });
  });

  it('classifies offline/network failures with a stable code', async () => {
    mockGetBackendEndpoint.mockReturnValue(null);

    const result = await votePhotoContest('e1');

    expect(result).toMatchObject({ ok: false, code: 'offline' });
  });
});

describe('clearPhotoContestVote', () => {
  it('DELETEs the vote and returns ok on 204', async () => {
    const spy = fetchResolving(204, undefined);

    expect(await clearPhotoContestVote()).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/photo-contest/vote');
    expect(init.method).toBe('DELETE');
  });

  it('surfaces the error envelope on failure', async () => {
    fetchResolving(409, { detail: 'Kolo skončilo.', code: 'contest_closed' });

    expect(await clearPhotoContestVote()).toEqual({
      ok: false,
      code: 'contest_closed',
      detail: 'Kolo skončilo.',
    });
  });
});
