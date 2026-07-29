import type { FriendPresence, MyPresence } from '@/data/friendsClient';
import { deriveSharedTable } from '../sharedTable';

function profile(id: string) {
  return { id, nickname: id, displayName: id, avatarUrl: null, isPublic: true };
}

function presence(overrides: Partial<FriendPresence> & { id: string }): FriendPresence {
  const { id, ...rest } = overrides;
  return {
    account: profile(id),
    pubName: 'U Zlatého tygra',
    pubCity: 'Praha',
    cacheKey: 'u2fkbn1z',
    lat: null,
    lng: null,
    since: '2026-07-29T17:00:00.000Z',
    lastSeenAt: '2026-07-29T18:00:00.000Z',
    beers: 2,
    lastDrinkName: 'Pilsner Urquell',
    activityId: null,
    ...rest,
  };
}

function mine(overrides: Partial<MyPresence> = {}): MyPresence {
  return { ...presence({ id: 'me' }), visibleToParta: true, ...overrides };
}

describe('deriveSharedTable', () => {
  it('finds the friend sitting in the same pub without anybody hanging an evening up', () => {
    const table = deriveSharedTable(mine(), [presence({ id: 'jarek' })]);

    expect(table).not.toBeNull();
    expect(table?.cacheKey).toBe('u2fkbn1z');
    expect(table?.pubName).toBe('U Zlatého tygra');
    expect(table?.friends.map((row) => row.account.id)).toEqual(['jarek']);
    expect(table?.headcount).toBe(2);
    expect(table?.beers).toBe(4);
  });

  it('ignores friends sitting somewhere else', () => {
    const table = deriveSharedTable(mine(), [
      presence({ id: 'jarek', cacheKey: 'jinde12', pubName: 'Lokál' }),
    ]);

    expect(table).toBeNull();
  });

  it('is null when I am the only one sitting, and when I am not sitting at all', () => {
    expect(deriveSharedTable(mine(), [])).toBeNull();
    expect(deriveSharedTable(null, [presence({ id: 'jarek' })])).toBeNull();
  });

  it('does not build a table out of unplaceable sittings', () => {
    // An older backend (or a drink logged outside a pub) sends no cache key.
    // Two unknowns are not the same pub.
    expect(
      deriveSharedTable(mine({ cacheKey: '' }), [presence({ id: 'jarek', cacheKey: '' })]),
    ).toBeNull();
  });

  it('puts the freshest friend first and counts everyone at the table', () => {
    const table = deriveSharedTable(mine({ beers: 1 }), [
      presence({ id: 'tichy', lastSeenAt: '2026-07-29T17:10:00.000Z', beers: 3 }),
      presence({ id: 'cerstvy', lastSeenAt: '2026-07-29T18:30:00.000Z', beers: 2 }),
      presence({ id: 'jinde', cacheKey: 'jinde12', beers: 9 }),
    ]);

    expect(table?.friends.map((row) => row.account.id)).toEqual(['cerstvy', 'tichy']);
    expect(table?.headcount).toBe(3);
    expect(table?.beers).toBe(6);
  });

  it('falls back to a friend row for the pub name when my own row has none', () => {
    const table = deriveSharedTable(mine({ pubName: '' }), [presence({ id: 'jarek' })]);

    expect(table?.pubName).toBe('U Zlatého tygra');
  });
});
