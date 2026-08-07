import { clearChallengesCache, fetchChallenges } from '../challengesClient';
import { ensureAccount } from '../account';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

beforeEach(() => {
  clearChallengesCache();
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  (ensureAccount as jest.Mock).mockResolvedValue({
    accountId: 'account-1',
    token: 'secret',
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  jest.clearAllMocks();
});

describe('challenges client', () => {
  it('parses server progress and friend rivals without placeholder data', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        challenges: [
          {
            id: 'pet-hospod',
            slug: 'pet-hospod',
            title: 'Pět hospod',
            glyph_key: 'places',
            metric_rule: 'distinct_pubs',
            target: 5,
            unit: 'hospod',
            blurb: 'Pět podniků.',
            reward: 'Odznak Poutník',
            rules: ['Každá hospoda jednou.'],
            window_start: '2026-08-01T00:00:00+02:00',
            window_end: '2026-09-01T00:00:00+02:00',
            progress: { current: 2, target: 5, ratio: 0.4 },
            rivals: [
              {
                account: {
                  id: 'friend-1',
                  nickname: 'pepa',
                  display_name: 'Pepa',
                  avatar_url: null,
                },
                progress: 3,
              },
            ],
          },
        ],
      }),
    })) as unknown as typeof fetch;

    await expect(fetchChallenges()).resolves.toEqual([
      expect.objectContaining({
        id: 'pet-hospod',
        current: 2,
        ratio: 0.4,
        rivals: [
          {
            account: {
              id: 'friend-1',
              nickname: 'pepa',
              displayName: 'Pepa',
              avatarUrl: null,
            },
            progress: 3,
          },
        ],
      }),
    ]);
  });

  it('keeps cached rivals bound to the current account', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ challenges: [] }),
    })) as unknown as typeof fetch;

    await fetchChallenges();
    await fetchChallenges();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    (ensureAccount as jest.Mock).mockResolvedValue({ accountId: 'account-2', token: 'next' });
    await fetchChallenges();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('treats an older backend without the endpoint as no challenges', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
    })) as unknown as typeof fetch;

    await expect(fetchChallenges()).resolves.toEqual([]);
  });

  it('returns null instead of throwing for other non-success responses', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch;

    await expect(fetchChallenges()).resolves.toBeNull();
  });
});
