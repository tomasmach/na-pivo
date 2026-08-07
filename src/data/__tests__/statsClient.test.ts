jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'me', token: 'token' })),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `https://api.test${path}`,
}));

import { fetchMyStats } from '../statsClient';

beforeEach(() => {
  jest.restoreAllMocks();
});

it('requests and parses whole-night personal bests excluding the recap day', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      total_evenings: 2,
      total_nights: 1,
      records: {},
      periods: {},
      night_records: {
        most_beers: 7,
        longest_seconds: 14_400,
        most_stops: 3,
        most_beers_date: '2026-08-05',
        most_beers_pub_names: ['U Tygra', 'Lokál', 'U Tygra'],
        longest_date: '2026-08-05',
        longest_pub_names: ['U Tygra', 'Lokál'],
      },
      timeline: {
        days: [{
          period: '2026-08-05',
          beers: 7,
          evenings: 2,
          distinct_pubs: 2,
          longest_evening_seconds: 7_200,
        }],
        streak: { current_weeks: 1, best_weeks: 1 },
        windows: { week: { beers: 7, evenings: 2, distinct_pubs: 2 } },
      },
      night_timeline: {
        days: [{
          period: '2026-08-05',
          beers: 7,
          evenings: 1,
          distinct_pubs: 2,
          longest_evening_seconds: 14_400,
        }],
        streak: { current_weeks: 1, best_weeks: 3 },
        windows: { week: { beers: 7, evenings: 1, distinct_pubs: 2 } },
      },
    }),
  } as Response);

  const stats = await fetchMyStats(undefined, '2026-08-05');

  expect(fetchMock.mock.calls[0]?.[0]).toEqual(
    expect.stringContaining('exclude_drinking_day=2026-08-05'),
  );
  expect(stats?.nightRecords).toEqual({
    mostBeers: 7,
    longestSeconds: 14_400,
    mostStops: 3,
    mostBeersDate: '2026-08-05',
    mostBeersPubNames: ['U Tygra', 'Lokál'],
    longestDate: '2026-08-05',
    longestPubNames: ['U Tygra', 'Lokál'],
  });
  expect(stats?.totalNights).toBe(1);
  expect(stats?.timeline?.windows?.week.evenings).toBe(2);
  expect(stats?.nightTimeline?.windows?.week.evenings).toBe(1);
  expect(stats?.nightTimeline?.streak.bestWeeks).toBe(3);
});
