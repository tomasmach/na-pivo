/**
 * Local rank arithmetic over a cached weekly board.
 *
 * The server board is cached (client 5 min, server-side window too), so beers
 * logged right now aren't in `me.score` yet. For the counter chip and the
 * post-log "posun v žebříčku" moment we project my rank optimistically against
 * the visible top slice — motivational copy, not an audit. Ties break in my
 * favour, and we never claim a worse rank than the server already granted.
 */

import type { Leaderboard } from '@/data/leaderboardsClient';

/**
 * My projected rank after logging `extraBeers` beers the cached board doesn't
 * know about. Returns null when nothing rankable (zero score), and falls back
 * to the server rank when the projected score still sits below the visible
 * slice (the true rank is unknowable locally).
 */
export function optimisticRankAfter(board: Leaderboard, extraBeers: number): number | null {
  const myScore = board.me.score + Math.max(0, extraBeers);
  if (myScore <= 0) return null;

  const others = board.entries.filter((e) => !e.isMe);
  if (others.length === 0) {
    // Nobody visible to race: trust the server, or claim the top of an empty board.
    return board.me.rank ?? (board.totalRanked === 0 ? 1 : null);
  }

  const lowestVisible = Math.min(...others.map((e) => e.score));
  if (myScore < lowestVisible) return board.me.rank;

  const ahead = others.filter((e) => e.score > myScore).length;
  const rank = ahead + 1;
  return board.me.rank != null ? Math.min(rank, board.me.rank) : rank;
}
