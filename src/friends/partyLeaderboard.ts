import type { LeaderboardEntry } from '@/data/friendsClient';

/** Rank only disclosed counts. A private member must not disable a metric. */
export function partyLeaderboard(entries: LeaderboardEntry[], requestedMetric: 0 | 1) {
  const hasBeers = entries.some((entry) => entry.beers30d !== undefined);
  const metric = hasBeers ? requestedMetric : 1;
  const rows = entries.flatMap((entry) => {
    const value = metric === 0 ? entry.beers30d : entry.visits30d;
    return typeof value === 'number' ? [{ ...entry, value }] : [];
  });
  rows.sort((a, b) => b.value - a.value ||
    (metric === 0 ? (b.visits30d ?? 0) - (a.visits30d ?? 0) : 0) ||
    b.sharedCount - a.sharedCount);
  return { hasBeers, metric, rows };
}

/** Choose empty copy from the retained friend list as well as available counts. */
export function partyLeaderboardEmptyMessage(boardCount: number, friendCount: number) {
  if (boardCount > 1) return 'leaderboardPrivateEmpty';
  return friendCount > 0 ? 'leaderboardUnavailable' : 'leaderboardEmpty';
}
