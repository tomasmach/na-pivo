jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { allSessionsNewestFirst, findSessionByStart, tonightSittings, type TallySession } from '../tallyStore';

function session(startedAt: string, drinkCount: number, over: Partial<TallySession> = {}): TallySession {
  return {
    clientId: over.clientId ?? `visit-${startedAt}`,
    pubKey: over.pubKey ?? `key-${startedAt}`,
    pubName: over.pubName ?? 'U Zlatého tygra',
    startedAt,
    drinks: Array.from({ length: drinkCount }, (_, i) => ({
      id: `${startedAt}-${i}`,
      beerName: 'Pilsner',
      priceCzk: 62,
      at: startedAt,
    })),
  };
}

describe('allSessionsNewestFirst', () => {
  it('returns only history when there is no current session', () => {
    const history = [session('2026-06-13T19:00:00.000Z', 2)];
    expect(allSessionsNewestFirst(null, history)).toEqual(history);
  });

  it('prepends a non-empty current session', () => {
    const current = session('2026-06-14T19:00:00.000Z', 1);
    const history = [session('2026-06-13T19:00:00.000Z', 2)];
    const all = allSessionsNewestFirst(current, history);
    expect(all).toHaveLength(2);
    expect(all[0]).toBe(current);
  });

  it('ignores an empty current session (e.g. all drinks undone)', () => {
    const current = session('2026-06-14T19:00:00.000Z', 0);
    const history = [session('2026-06-13T19:00:00.000Z', 2)];
    expect(allSessionsNewestFirst(current, history)).toEqual(history);
  });
});

describe('findSessionByStart', () => {
  const current = session('2026-06-14T19:00:00.000Z', 1);
  const history = [
    session('2026-06-13T19:00:00.000Z', 2),
    session('2026-06-10T19:00:00.000Z', 3),
  ];

  it('finds a session in history by startedAt', () => {
    const found = findSessionByStart(current, history, '2026-06-10T19:00:00.000Z');
    expect(found?.drinks).toHaveLength(3);
  });

  it('finds the live current session', () => {
    const found = findSessionByStart(current, history, '2026-06-14T19:00:00.000Z');
    expect(found).toBe(current);
  });

  it('returns null when nothing matches', () => {
    expect(findSessionByStart(current, history, 'nope')).toBeNull();
  });
});

describe('tonightSittings', () => {
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString();
  const ids = (sittings: TallySession[]) => sittings.map((sitting) => sitting.clientId);
  const yesterday = session(at(23, 20), 2, { clientId: 'yesterday' });
  const tygr = session(at(24, 19), 3, { clientId: 'tygr' });

  it('keeps the earlier pubs of the live night and the live one, oldest first', () => {
    const lokal = session(at(25, 1), 1, { clientId: 'lokal' });
    expect(ids(tonightSittings(lokal, [tygr, yesterday], Date.parse(at(25, 1))))).toEqual(['tygr', 'lokal']);
  });

  it('keeps the night after Dopito until the day turns at 4:00', () => {
    expect(ids(tonightSittings(null, [tygr, yesterday], Date.parse(at(25, 2))))).toEqual(['tygr']);
    expect(tonightSittings(null, [tygr, yesterday], Date.parse(at(25, 5)))).toEqual([]);
  });
});
