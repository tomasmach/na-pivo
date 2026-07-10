import { optimisticRankAfter } from '@/leaderboards/rankMath';
import type { Leaderboard, BoardEntry } from '@/data/leaderboardsClient';

function entry(rank: number, score: number, isMe = false): BoardEntry {
  return {
    rank,
    score,
    isMe,
    isFriend: false,
    account: { id: `acc-${rank}`, nickname: null, displayName: `Pivař ${rank}`, avatarUrl: null },
  };
}

function board(overrides: Partial<Leaderboard>): Leaderboard {
  return {
    category: 'beers',
    period: 'week',
    periodStart: null,
    totalRanked: 0,
    entries: [],
    me: { rank: null, score: 0, listed: false, eligible: true },
    ...overrides,
  };
}

describe('optimisticRankAfter', () => {
  it('returns null when nothing rankable', () => {
    expect(optimisticRankAfter(board({}), 0)).toBeNull();
  });

  it('claims the top of an empty board with a fresh score', () => {
    expect(optimisticRankAfter(board({ totalRanked: 0 }), 1)).toBe(1);
  });

  it('moves past overtaken visible entries', () => {
    const b = board({
      totalRanked: 3,
      entries: [entry(1, 10), entry(2, 7), entry(3, 5)],
      me: { rank: 4, score: 4, listed: false, eligible: true },
    });
    // 4 + 2 = 6 beers → past the 5-beer row, behind 10 and 7.
    expect(optimisticRankAfter(b, 2)).toBe(3);
  });

  it('breaks ties in my favour', () => {
    const b = board({
      totalRanked: 2,
      entries: [entry(1, 10), entry(2, 6)],
      me: { rank: 3, score: 5, listed: false, eligible: true },
    });
    expect(optimisticRankAfter(b, 1)).toBe(2);
  });

  it('falls back to the server rank below the visible slice', () => {
    const b = board({
      totalRanked: 100,
      entries: [entry(1, 50), entry(2, 40)],
      me: { rank: 80, score: 2, listed: false, eligible: true },
    });
    expect(optimisticRankAfter(b, 1)).toBe(80);
  });

  it('never claims worse than the server rank', () => {
    // The slice can omit players between its floor and me; the count-based
    // projection would say 3, but the server already granted 2.
    const b = board({
      totalRanked: 5,
      entries: [entry(1, 10), entry(2, 8), entry(3, 6)],
      me: { rank: 2, score: 8, listed: false, eligible: true },
    });
    expect(optimisticRankAfter(b, 0)).toBe(2);
  });

  it('ignores my own listed row when counting who is ahead', () => {
    const b = board({
      totalRanked: 2,
      entries: [entry(1, 9), entry(2, 4, true)],
      me: { rank: 2, score: 4, listed: true, eligible: true },
    });
    expect(optimisticRankAfter(b, 6)).toBe(1);
  });
});
