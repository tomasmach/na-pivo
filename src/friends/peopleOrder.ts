/**
 * "S kým chodíš na pivo" — the order of the people list.
 *
 * Most evenings together first, because that count is what the row leads with:
 * any other order (alphabetical, by when the friendship was made) puts the
 * numerals in a random sequence and turns a scannable column into noise.
 *
 * Ties break on who you saw most recently — two people with three evenings each
 * are not equal if one of them was last night. Friends the backend has no stats
 * for sort last rather than disappearing; a missing count is "we haven't sat
 * together yet", which is true and worth showing.
 */

import type { FriendProfile, FriendStats } from '@/data/friendsClient';

function lastSharedMs(stats: FriendStats | undefined): number {
  const parsed = Date.parse(stats?.lastSharedAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortByEveningsTogether(
  friends: FriendProfile[],
  stats: Record<string, FriendStats>,
): FriendProfile[] {
  return [...friends].sort((a, b) => {
    const byCount = (stats[b.id]?.sharedPubCount ?? 0) - (stats[a.id]?.sharedPubCount ?? 0);
    if (byCount !== 0) return byCount;
    return lastSharedMs(stats[b.id]) - lastSharedMs(stats[a.id]);
  });
}
