/**
 * "Sedíte spolu" — the shared table, worked out instead of declared.
 *
 * Parta used to have a second, manual answer to "who is here with me": you hung
 * an evening up, read a six-letter code out loud, everyone typed it in, and then
 * logged every beer twice — once into the diary that counts and once into a
 * table that counted nothing. It was a worse copy of a fact the app already had.
 *
 * The app already has it because presence is derived server-side from the pub
 * visits the counter syncs, and every row carries the pub's `cacheKey`. Two
 * people sitting in the same pub right now are two presence rows with the same
 * key. That is the whole detection: no code, no button, no second entry of the
 * same round.
 *
 * Deliberately keyed on `cacheKey` alone. It is the pub's identity everywhere
 * else in the app (compass hand-off, shared-evening stats, the drink feed), and
 * presence is already "right now" — the server only emits a row while the
 * sitting is live, so an extra time-overlap check here would re-derive a
 * decision that has already been made upstream. A row without a `cacheKey` is a
 * sitting we cannot place (an older backend, or a drink logged outside a pub),
 * and an unplaceable sitting joins nobody's table.
 */

import type { FriendPresence, MyPresence } from '@/data/friendsClient';

export interface SharedTable {
  /** The pub everyone at this table is sitting in. */
  cacheKey: string;
  pubName: string;
  /** Friends sitting here with me, freshest sign of life first. */
  friends: FriendPresence[];
  /** Everyone at the table, me included. */
  headcount: number;
  /** Beers logged at this table so far, mine included. */
  beers: number;
}

function freshness(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Who from the party is sitting in the same pub as me right now, or null when
 * I am not sitting anywhere, or sitting alone.
 */
export function deriveSharedTable(
  myPresence: MyPresence | null,
  presence: FriendPresence[],
): SharedTable | null {
  const cacheKey = myPresence?.cacheKey;
  if (!myPresence || !cacheKey) return null;

  const friends = presence
    .filter((row) => row.cacheKey === cacheKey)
    .sort((a, b) => freshness(b.lastSeenAt) - freshness(a.lastSeenAt));
  if (friends.length === 0) return null;

  return {
    cacheKey,
    // My own row names the pub as well as theirs, and it is the one I can be
    // sure is not a stale mirror of a rename.
    pubName: myPresence.pubName || friends[0].pubName,
    friends,
    headcount: friends.length + 1,
    beers: friends.reduce((sum, row) => sum + row.beers, myPresence.beers),
  };
}
