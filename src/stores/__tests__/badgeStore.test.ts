jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { EMPTY_LEDGER, observeTiers, useBadgeStore } from '@/stores/badgeStore';

describe('observeTiers', () => {
  it('records the first look at an account silently', () => {
    const { ledger, raised } = observeTiers(EMPTY_LEDGER, 'a', { pubs: 2, beers: 3 });

    expect(raised).toEqual([]);
    expect(ledger).toEqual({ accountId: 'a', seen: { pubs: 2, beers: 3 }, unopened: [], recent: [] });
  });

  it('raises a badge that went up and keeps it unopened and recent, newest first', () => {
    const start = { accountId: 'a', seen: { pubs: 1, beers: 2 }, unopened: ['beers' as const], recent: ['beers' as const] };

    const { ledger, raised } = observeTiers(start, 'a', { pubs: 2, beers: 2 });

    expect(raised).toEqual(['pubs']);
    expect(ledger.unopened).toEqual(['pubs', 'beers']);
    expect(ledger.recent).toEqual(['pubs', 'beers']);
  });

  it('never celebrates a level twice after it dropped and came back', () => {
    const start = { accountId: 'a', seen: { beers: 2 }, unopened: [], recent: [] };

    const dropped = observeTiers(start, 'a', { beers: 1 });
    const back = observeTiers(dropped.ledger, 'a', { beers: 2 });

    expect(dropped.ledger.seen.beers).toBe(2);
    expect(back.raised).toEqual([]);
  });

  it('starts silently for another account and for a badge it has never seen', () => {
    const start = { accountId: 'a', seen: { beers: 1 }, unopened: ['beers' as const], recent: [] };

    expect(observeTiers(start, 'b', { beers: 3 })).toEqual({
      ledger: { accountId: 'b', seen: { beers: 3 }, unopened: [], recent: [] },
      raised: [],
    });
    expect(observeTiers(start, 'a', { beers: 1, cities: 2 }).raised).toEqual([]);
  });
});

describe('opening a medal', () => {
  beforeEach(() => useBadgeStore.getState().reset());

  it('mints an unopened medal once and starts a new session each time', () => {
    useBadgeStore.setState({ accountId: 'a', unopened: ['pubs'] });

    useBadgeStore.getState().open('pubs');
    const first = useBadgeStore.getState().sheet;
    useBadgeStore.getState().close();
    useBadgeStore.getState().open('pubs');
    const second = useBadgeStore.getState().sheet;

    expect(first).toMatchObject({ key: 'pubs', minting: true });
    expect(second).toMatchObject({ key: 'pubs', minting: false });
    expect(second?.session).toBe((first?.session ?? 0) + 1);
    expect(useBadgeStore.getState().unopened).toEqual([]);
  });
});
