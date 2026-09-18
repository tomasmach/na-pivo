import { partyLeaderboard } from '../partyLeaderboard';
import type { LeaderboardEntry } from '@/data/friendsClient';

function row(id: string, visits30d: number | null, beers30d?: number | null, sharedCount = 0): LeaderboardEntry {
  return { account: { id, nickname: id, displayName: id, avatarUrl: null, isPublic: true }, visits30d, beers30d, sharedCount, isMe: id === 'me' };
}

it('keeps beers available in a mixed party, excluding private and ghost rows from both rankings', () => {
  const entries = [row('me', 1, 3), row('private', null, null), row('ghost', null, null), row('friend', 4, 2), row('zero', 0, 0)];
  const beer = partyLeaderboard(entries, 0);
  expect(beer.hasBeers).toBe(true);
  expect(beer.metric).toBe(0);
  expect(beer.rows.map((r) => [r.account.id, r.value])).toEqual([['me', 3], ['friend', 2], ['zero', 0]]);
  expect(partyLeaderboard(entries, 1).rows.map((r) => [r.account.id, r.value])).toEqual([['friend', 4], ['me', 1], ['zero', 0]]);
  expect(entries[1].account.id).toBe('private');
});

it('falls back to visits only when the old API omits beer counts', () => {
  const board = partyLeaderboard([row('me', 1), row('friend', 3)], 0);
  expect(board.hasBeers).toBe(false);
  expect(board.metric).toBe(1);
  expect(board.rows.map((r) => r.value)).toEqual([3, 1]);
});

it('keeps the toggle available when the selected metric has no shared counts', () => {
  const entries = [row('me', 2, null), row('friend', 3, null)];
  expect(partyLeaderboard(entries, 0)).toMatchObject({ hasBeers: true, metric: 0, rows: [] });
  expect(partyLeaderboard(entries, 1).rows).toHaveLength(2);
});

it('breaks beer ties by visits and then shared evenings; visit ties by shared evenings', () => {
  const entries = [row('last', 1, 5, 9), row('second', 2, 5, 1), row('first', 2, 5, 2)];
  for (const metric of [0, 1] as const) {
    expect(partyLeaderboard(entries, metric).rows.map((r) => r.account.id)).toEqual(['first', 'second', 'last']);
  }
});

it('has no ranked rows for an empty or fully private party', () => {
  expect(partyLeaderboard([], 0).rows).toEqual([]);
  for (const metric of [0, 1] as const) {
    expect(partyLeaderboard([row('private', null, null)], metric).rows).toEqual([]);
  }
});
