import { clearChallengesCache, fetchChallenges } from '@/data/challengesClient';

jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'me', token: 'token' })),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
}));
jest.mock('@/data/backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));
jest.mock('@/data/telemetryClient', () => ({ trackApiFailure: jest.fn() }));

beforeEach(() => {
  clearChallengesCache();
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      challenges: [
        {
          id: 'new-pubs-month',
          title: 'Deset nových hospod',
          glyph: 'places',
          done: 2,
          goal: 10,
          progress: 0.2,
          unit: 'hospod',
          rules: ['Jednou.'],
          friends: [
            {
              account: {
                id: 'friend-1',
                nickname: 'honza',
                display_name: 'Honza',
                avatar_url: 'https://cdn.test/honza.jpg',
                is_public: false,
              },
              done: 3,
              progress: 0.3,
            },
          ],
        },
      ],
    }),
  })) as jest.Mock;
});

it('parses server-derived progress and caches it per account', async () => {
  const first = await fetchChallenges();
  const second = await fetchChallenges();
  expect(first?.[0]).toMatchObject({ id: 'new-pubs-month', done: 2, progress: 0.2 });
  expect(first?.[0].friends).toEqual([
    {
      account: {
        id: 'friend-1',
        nickname: 'honza',
        displayName: 'Honza',
        avatarUrl: 'https://cdn.test/honza.jpg',
        isPublic: false,
      },
      done: 3,
      progress: 0.3,
    },
  ]);
  expect(second).toEqual(first);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('keeps older challenge payloads compatible when friend progress is omitted', async () => {
  const rows = await fetchChallenges();

  expect(rows?.[0].friends).toHaveLength(1);
  clearChallengesCache();
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      challenges: [{ id: 'legacy', title: 'Stará výzva' }],
    }),
  });

  await expect(fetchChallenges()).resolves.toEqual([
    expect.objectContaining({ id: 'legacy', friends: [] }),
  ]);
});
