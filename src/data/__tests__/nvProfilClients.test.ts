import { resolveInviteCode } from '../friendsClient';
import { fetchXpEvents } from '../xpEventsClient';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 'test-token' })),
  clearCachedAnonymousAccount: jest.fn(),
}));
jest.mock('../friendsSnapshot', () => ({ snapshotGeneration: () => 0, saveFriendsDashboardSnapshot: jest.fn() }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://localhost${path}` }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function respond(body: unknown, status = 200) {
  const fetchMock = jest.fn(async (_url: string) => ({
    ok: status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const inviter = { id: 'a1', nickname: 'klara', display_name: 'Klára', avatar_url: null, is_public: true };

describe('resolveInviteCode', () => {
  it('still reads the response of a backend without the preview fields', async () => {
    respond({ valid: true, expired: false, inviter });
    const result = await resolveInviteCode('code');
    expect(result.valid).toBe(true);
    expect(result.inviter?.nickname).toBe('klara');
    expect(result.publicStats).toBeNull();
    expect(result.mutualFriends).toBeUndefined();
  });

  it('reads public stats and mutual friends', async () => {
    respond({
      valid: true,
      expired: false,
      inviter,
      public_stats: { total_beers: 211, distinct_pubs: 38, mapper_level: 7, mapper_title: 'Štamgast', badge_progress: { beers: 211 } },
      mutual_friends: { count: 4, profiles: [{ ...inviter, id: 'j', nickname: 'jirka' }] },
    });
    const result = await resolveInviteCode('code');
    expect(result.publicStats).toMatchObject({ totalBeers: 211, distinctPubs: 38, mapperLevel: 7, mapperTitle: 'Štamgast' });
    expect(result.publicStats?.badgeProgress.beers).toBe(211);
    expect(result.publicStats?.badgeProgress.partyEvenings).toBe(0);
    expect(result.mutualFriends?.count).toBe(4);
    expect(result.mutualFriends?.profiles.map((p) => p.nickname)).toEqual(['jirka']);
  });
});

describe('fetchXpEvents', () => {
  it('passes since and drops rows it does not understand', async () => {
    const fetchMock = respond({
      events: [
        { reason: 'mapping', amount: 20, cache_key: 'u2fk', pub_name: 'U Zlatého tygra', created_at: '2026-11-01T10:00:00Z' },
        { reason: 'future_reason', amount: 5 },
        { reason: 'drink', amount: 0 },
      ],
    });
    const events = await fetchXpEvents('2026-10-01T00:00:00.000Z');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost/v1/account/me/xp-events?since=2026-10-01T00%3A00%3A00.000Z',
    );
    expect(events).toEqual([
      { reason: 'mapping', amount: 20, cacheKey: 'u2fk', pubName: 'U Zlatého tygra', createdAt: '2026-11-01T10:00:00Z' },
    ]);
  });

  it('returns null on an older backend without the endpoint', async () => {
    respond({ detail: 'Not found' }, 404);
    await expect(fetchXpEvents()).resolves.toBeNull();
  });
});
