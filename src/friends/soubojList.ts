/**
 * The Souboje list on the Parta hub, derived from data the dashboard already
 * carries.
 *
 * `FriendsDashboard.leaderboard` has every party member's trailing-30-day beer
 * tally, mine included — it was built for the board 3.0 dropped and has been
 * arriving unread ever since. Turning it into "you lead by two" costs one pure
 * function and no new request.
 *
 * The list stays a list of pairs on purpose. Sorting everyone into one ranking
 * is the podium this feature exists to avoid; sorting by how close the duel is
 * puts the ones worth opening on top instead.
 */

import type { LeaderboardEntry } from '@/data/friendsClient';

export interface SoubojRow {
  entry: LeaderboardEntry;
  /** My beers minus theirs over the same 30 days. */
  diff: number;
  /**
   * Null when the friend's tally never arrived — an older backend, or somebody
   * who keeps their drink feed private. A null is drawn as "no numbers", never
   * as a zero: a zero says they stopped drinking.
   */
  mine: number | null;
  theirs: number | null;
}

/**
 * One row per friend, closest duel first.
 *
 * Ties come before decided ones, and a friend with no numbers sinks to the
 * bottom rather than disappearing: the row is still the door to their profile.
 */
export function soubojRows(leaderboard: LeaderboardEntry[]): SoubojRow[] {
  const me = leaderboard.find((entry) => entry.isMe);
  const myBeers = me?.beers30d ?? null;

  return leaderboard
    .filter((entry) => !entry.isMe)
    .map((entry) => {
      const theirs = entry.beers30d;
      const comparable = myBeers !== null && theirs !== null;
      return {
        entry,
        mine: myBeers,
        theirs,
        diff: comparable ? myBeers - theirs : 0,
      };
    })
    .sort((left, right) => {
      const leftKnown = left.theirs !== null && left.mine !== null;
      const rightKnown = right.theirs !== null && right.mine !== null;
      if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
      return Math.abs(left.diff) - Math.abs(right.diff);
    });
}
