import type { LeaderboardPeriod } from '@/data/leaderboardsClient';

type RouteParam = string | string[] | undefined;

/** Keep each leaderboard entry point aligned with the number that led into it. */
export function resolveInitialLeaderboardPeriod(
  requestedPeriod: RouteParam,
  source: RouteParam,
): LeaderboardPeriod {
  const period = Array.isArray(requestedPeriod) ? requestedPeriod[0] : requestedPeriod;
  if (period === 'week' || period === 'year' || period === 'all') return period;

  const entrySource = Array.isArray(source) ? source[0] : source;
  return entrySource === 'profile' ? 'all' : 'week';
}
