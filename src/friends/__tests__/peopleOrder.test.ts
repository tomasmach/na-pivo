import type { FriendProfile, FriendStats } from '@/data/friendsClient';

import { sortByEveningsTogether } from '../peopleOrder';

function person(id: string): FriendProfile {
  return { id, nickname: id, displayName: id, avatarUrl: null, isPublic: true };
}

function stats(sharedPubCount: number, lastSharedAt: string | null): FriendStats {
  return { sharedPubCount, lastSharedAt, lastPubName: '', rituals: [] };
}

describe('sortByEveningsTogether', () => {
  it('puts the most evenings first', () => {
    const order = sortByEveningsTogether([person('a'), person('b'), person('c')], {
      a: stats(3, null),
      b: stats(14, null),
      c: stats(9, null),
    });

    expect(order.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie on who I saw most recently', () => {
    const order = sortByEveningsTogether([person('older'), person('fresh')], {
      older: stats(4, '2026-01-01T20:00:00Z'),
      fresh: stats(4, '2026-08-01T20:00:00Z'),
    });

    expect(order.map((p) => p.id)).toEqual(['fresh', 'older']);
  });

  it('keeps friends the backend has no stats for, at the end', () => {
    const order = sortByEveningsTogether([person('unknown'), person('known')], {
      known: stats(1, null),
    });

    expect(order.map((p) => p.id)).toEqual(['known', 'unknown']);
  });

  it('does not mutate the list it was given', () => {
    const input = [person('a'), person('b')];
    sortByEveningsTogether(input, { a: stats(1, null), b: stats(5, null) });

    expect(input.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
