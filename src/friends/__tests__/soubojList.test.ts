import type { LeaderboardEntry } from '@/data/friendsClient';

import { soubojRows } from '../soubojList';

function entry(id: string, beers30d: number | null, isMe = false): LeaderboardEntry {
  return {
    account: {
      id,
      nickname: id,
      displayName: id,
      avatarUrl: null,
      isPublic: true,
    } as LeaderboardEntry['account'],
    visits30d: 0,
    beers30d,
    sharedCount: 0,
    isMe,
  };
}

describe('soubojRows', () => {
  it('measures every friend against me and drops my own row', () => {
    const rows = soubojRows([entry('me', 20, true), entry('pepa', 14), entry('luky', 26)]);

    expect(rows.map((row) => row.entry.account.id)).toEqual(['pepa', 'luky']);
    expect(rows.find((row) => row.entry.account.id === 'pepa')?.diff).toBe(6);
    expect(rows.find((row) => row.entry.account.id === 'luky')?.diff).toBe(-6);
  });

  it('puts the closest duel first', () => {
    const rows = soubojRows([
      entry('me', 20, true),
      entry('far', 2),
      entry('close', 21),
      entry('tied', 20),
    ]);

    expect(rows.map((row) => row.entry.account.id)).toEqual(['tied', 'close', 'far']);
  });

  it('keeps a friend with no tally, sunk to the bottom and marked unknown', () => {
    const rows = soubojRows([entry('me', 20, true), entry('quiet', null), entry('pepa', 19)]);

    expect(rows.map((row) => row.entry.account.id)).toEqual(['pepa', 'quiet']);
    expect(rows.at(-1)?.theirs).toBeNull();
    expect(rows.at(-1)?.diff).toBe(0);
  });

  it('compares nothing when my own tally is missing', () => {
    const rows = soubojRows([entry('me', null, true), entry('pepa', 19)]);

    expect(rows).toHaveLength(1);
    expect(rows[0].mine).toBeNull();
    expect(rows[0].diff).toBe(0);
  });

  it('survives a board that does not contain me', () => {
    const rows = soubojRows([entry('pepa', 19)]);

    expect(rows).toHaveLength(1);
    expect(rows[0].mine).toBeNull();
  });

  it('returns nothing for an empty board', () => {
    expect(soubojRows([])).toEqual([]);
  });
});
