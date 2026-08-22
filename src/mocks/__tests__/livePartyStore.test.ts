import {
  partyTapOptions,
  restoreLivePartyState,
  useLivePartyStore,
} from '@/mocks/livePartyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('livePartyStore persistence boundary', () => {
  it('keeps the full tap menu, dedupes names, and preserves a known price', () => {
    expect(
      partyTapOptions(
        [
          { name: 'Plzeň', priceCzk: 65 },
          { name: 'Radegast', priceCzk: 58 },
        ],
        [{ name: ' plzeň ', priceCzk: null }],
      ),
    ).toEqual([
      { name: 'Plzeň', priceCzk: 65 },
      { name: 'Radegast', priceCzk: 58 },
    ]);
  });

  it('restores a recent offline table without restoring transient picker chrome', () => {
    const now = Date.parse('2026-08-06T20:00:00.000Z');
    const current = useLivePartyStore.getState();

    const restored = restoreLivePartyState({
      live: true,
      pubName: 'U Zlatého tygra',
      pickingPub: true,
      houseBeer: 'Plzeň',
      pubKey: 'u2fkbn1x',
      startedAt: now - 60_000,
      games: [{ key: 'quiz', name: 'Pub kvíz', at: now - 30_000 }],
    }, current, now);

    expect(restored).toMatchObject({
      live: true,
      pubName: 'U Zlatého tygra',
      pickingPub: false,
      houseBeer: 'Plzeň',
      pubKey: 'u2fkbn1x',
      startedAt: now - 60_000,
      games: [{ key: 'quiz', name: 'Pub kvíz', at: now - 30_000 }],
    });
    expect(restored.start).toBe(current.start);
  });

  it('drops stale, future, and malformed snapshots instead of reviving a zombie night', () => {
    const now = Date.parse('2026-08-06T20:00:00.000Z');
    const current = useLivePartyStore.getState();

    expect(restoreLivePartyState({ live: true, startedAt: now - 86_400_001 }, current, now))
      .toBe(current);
    expect(restoreLivePartyState({ live: true, startedAt: now + 1 }, current, now)).toBe(current);
    expect(restoreLivePartyState({ live: true, startedAt: 'yesterday' }, current, now))
      .toBe(current);
  });

  it('keeps an idempotent visit identity for a pub chosen before its first beer', () => {
    useLivePartyStore.getState().end();

    const opened = useLivePartyStore.getState().start(
      'Lokál',
      'Plzeň',
      'u2fkbn1x',
      [{ name: 'Plzeň', priceCzk: 69 }],
      'Praha',
      'place-lokal',
    );

    expect(opened?.current).toMatchObject({
      pubKey: 'u2fkbn1x',
      pubName: 'Lokál',
      pubCity: 'Praha',
      pubExternalId: 'place-lokal',
    });
    expect(opened?.current.clientId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(useLivePartyStore.getState().pubVisits).toEqual([opened?.current]);

    expect(
      useLivePartyStore.getState().setPub('Lokál', 'Plzeň', 'u2fkbn1x'),
    ).toBeNull();
    expect(useLivePartyStore.getState().pubVisits).toHaveLength(1);

    useLivePartyStore.getState().end();
  });

  it('closes the previous stop and opens a new one when the table moves without beer', () => {
    useLivePartyStore.getState().end();
    const first = useLivePartyStore.getState().start('Lokál', 'Plzeň', 'u2fkbn1x');
    const moved = useLivePartyStore.getState().setPub('U Pinkasů', 'Kozel', 'u2fkbn2y');

    expect(moved?.previous).toMatchObject({
      clientId: first?.current.clientId,
      pubName: 'Lokál',
    });
    expect(moved?.previous?.endedAt).toBeTruthy();
    expect(moved?.current).toMatchObject({ pubName: 'U Pinkasů', pubKey: 'u2fkbn2y' });
    expect(useLivePartyStore.getState().pubVisits).toEqual([
      moved?.previous,
      moved?.current,
    ]);

    useLivePartyStore.getState().end();
  });

  it('clears the previous place when a new off-grid table starts', () => {
    useLivePartyStore.getState().end();
    useLivePartyStore.getState().start('Lokál', 'Plzeň', 'u2fkbn1x');

    useLivePartyStore.getState().start('Mimo hospodu', 'Pivo');

    expect(useLivePartyStore.getState()).toMatchObject({
      live: true,
      pubName: 'Mimo hospodu',
      pubKey: null,
      pubVisits: [],
    });
    useLivePartyStore.getState().end();
  });

  it('adopts the canonical shared start time without losing the joined table', () => {
    useLivePartyStore.getState().end();
    useLivePartyStore.getState().start('Mimo hospodu', 'Pivo');
    const sharedStartedAt = '2026-08-21T17:23:00.000Z';

    useLivePartyStore.getState().resume('Mimo hospodu', sharedStartedAt);

    expect(useLivePartyStore.getState()).toMatchObject({
      live: true,
      pubName: 'Mimo hospodu',
      pubKey: null,
      startedAt: Date.parse(sharedStartedAt),
    });
    useLivePartyStore.getState().end();
  });

  it('restores recent explicit stops for an offline cold launch', () => {
    const now = Date.parse('2026-08-06T20:00:00.000Z');
    const current = useLivePartyStore.getState();
    const visit = {
      clientId: 'f7799c00-4188-49f2-b586-bd695b94d817',
      pubKey: 'u2fkbn1x',
      pubName: 'Lokál',
      startedAt: '2026-08-06T19:00:00.000Z',
    };

    expect(
      restoreLivePartyState(
        { live: true, startedAt: now - 60_000, pubVisits: [visit] },
        current,
        now,
      ).pubVisits,
    ).toEqual([visit]);
  });
});
