import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The store mints a clientId per session via account.generateUuidV4 and, on
// reset, lazily requires visitsSync to retract visits. Keep both deterministic
// and network-free here.
let uuidSeq = 0;
jest.mock('@/data/account', () => ({ generateUuidV4: jest.fn(() => `uuid-${++uuidSeq}`) }));

const deleteVisitByClientId = jest.fn();
jest.mock('@/data/visitsSync', () => ({ deleteVisitByClientId, syncVisit: jest.fn() }));

import {
  useTallyStore,
  drinkingDayKey,
  shouldStartNewSession,
  sessionCount,
  sessionTotalCzk,
  sessionBeerCounts,
  migrateTally,
  type TallySession,
} from '../tallyStore';

const PUB_A = { pubKey: 'aaaaaaaa', pubName: 'U Zlatého tygra' };
const PUB_B = { pubKey: 'bbbbbbbb', pubName: 'U Černého vola' };

let idSeq = 0;
function beer(over: Partial<{ beerName: string; priceCzk: number; volumeMl: number; at: string }> = {}) {
  idSeq += 1;
  return {
    id: `id-${idSeq}`,
    beerName: over.beerName ?? 'Pilsner Urquell',
    priceCzk: over.priceCzk ?? 62,
    volumeMl: over.volumeMl,
    at: over.at,
  };
}

beforeEach(() => {
  idSeq = 0;
  (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, unknown> }).__INTERNAL_MOCK_STORAGE__ = {};
  useTallyStore.setState({ current: null, history: [] });
});

describe('addDrink', () => {
  it('starts a session on the first drink and records the beer', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ priceCzk: 50 }));
    const { current } = useTallyStore.getState();
    expect(current).not.toBeNull();
    expect(current?.pubKey).toBe(PUB_A.pubKey);
    expect(current?.pubName).toBe(PUB_A.pubName);
    expect(current?.drinks).toHaveLength(1);
    expect(current?.drinks[0].priceCzk).toBe(50);
    expect(current?.drinks[0].syncStatus).toBe('pending');
  });

  it('appends to the same session for the same pub on the same day', () => {
    const at = '2026-06-12T19:00:00.000Z';
    useTallyStore.getState().addDrink(PUB_A, beer({ at }));
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T19:30:00.000Z' }));
    const { current, history } = useTallyStore.getState();
    expect(current?.drinks).toHaveLength(2);
    expect(history).toHaveLength(0);
  });

  it('rolls into a new session and archives the old one when the pub changes', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().addDrink(PUB_B, beer());
    const { current, history } = useTallyStore.getState();
    expect(current?.pubKey).toBe(PUB_B.pubKey);
    expect(current?.drinks).toHaveLength(1);
    expect(history).toHaveLength(1);
    expect(history[0].pubKey).toBe(PUB_A.pubKey);
  });

  it('refreshes the pub name within an ongoing session', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().addDrink({ ...PUB_A, pubName: 'U Zlatého Tygra (přejmenováno)' }, beer());
    expect(useTallyStore.getState().current?.pubName).toBe('U Zlatého Tygra (přejmenováno)');
  });
});

describe('session rollover by drinking day (04:00 cutoff)', () => {
  it('keeps a 01:30 beer in the previous evening session (before the cutoff)', () => {
    // Use local-time ISO strings (no Z) so the device-local cutoff math is exercised.
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T22:00:00' }));
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-13T01:30:00' }));
    const { current, history } = useTallyStore.getState();
    expect(history).toHaveLength(0);
    expect(current?.drinks).toHaveLength(2);
  });

  it('starts a new session for a beer after the 04:00 cutoff the next day', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T22:00:00' }));
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-13T20:00:00' }));
    const { current, history } = useTallyStore.getState();
    expect(history).toHaveLength(1);
    expect(current?.drinks).toHaveLength(1);
  });

  it('drinkingDayKey shifts pre-04:00 times back to the previous calendar date', () => {
    expect(drinkingDayKey(new Date('2026-06-13T01:30:00'))).toBe(
      drinkingDayKey(new Date('2026-06-12T22:00:00')),
    );
    expect(drinkingDayKey(new Date('2026-06-13T04:30:00'))).not.toBe(
      drinkingDayKey(new Date('2026-06-12T22:00:00')),
    );
  });

  it('shouldStartNewSession is true for no session, pub change, and day rollover', () => {
    const session: TallySession = {
      clientId: 'session-a',
      pubKey: PUB_A.pubKey,
      pubName: PUB_A.pubName,
      startedAt: '2026-06-12T22:00:00',
      drinks: [],
    };
    expect(shouldStartNewSession(null, PUB_A.pubKey, new Date())).toBe(true);
    expect(shouldStartNewSession(session, PUB_B.pubKey, new Date('2026-06-12T22:30:00'))).toBe(true);
    expect(shouldStartNewSession(session, PUB_A.pubKey, new Date('2026-06-12T23:00:00'))).toBe(false);
    expect(shouldStartNewSession(session, PUB_A.pubKey, new Date('2026-06-13T20:00:00'))).toBe(true);
  });
});

describe('undoLast', () => {
  it('removes the most recent drink and returns its id', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().addDrink(PUB_A, beer());
    const lastId = useTallyStore.getState().current?.drinks[1].id;
    const removed = useTallyStore.getState().undoLast();
    expect(removed).toBe(lastId);
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
  });

  it('returns null when there is nothing to undo', () => {
    expect(useTallyStore.getState().undoLast()).toBeNull();
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().undoLast();
    // Session object remains but empty; another undo is a no-op.
    expect(useTallyStore.getState().undoLast()).toBeNull();
  });

  it('does not remove the last drink when the expected id no longer matches', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().addDrink(PUB_A, beer());
    expect(useTallyStore.getState().undoLast('id-1')).toBeNull();
    expect(useTallyStore.getState().current?.drinks).toHaveLength(2);
  });

  it('marks a drink as synced so delivered drinks are not treated as pending undo', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().markDrinkSynced('id-1');
    expect(useTallyStore.getState().current?.drinks[0].syncStatus).toBe('sent');
  });
});

describe('removeDrink', () => {
  it('removes a specific drink by id from anywhere in the session', () => {
    useTallyStore.getState().addDrink(PUB_A, beer()); // id-1
    useTallyStore.getState().addDrink(PUB_A, beer()); // id-2
    useTallyStore.getState().addDrink(PUB_A, beer()); // id-3

    // Remove the MIDDLE drink, not the most recent — this is the per-beer case.
    const removed = useTallyStore.getState().removeDrink('id-2');
    expect(removed).toBe('id-2');
    const ids = useTallyStore.getState().current?.drinks.map((d) => d.id);
    expect(ids).toEqual(['id-1', 'id-3']);
  });

  it('returns null and leaves the session untouched when the id is unknown', () => {
    useTallyStore.getState().addDrink(PUB_A, beer()); // id-1
    expect(useTallyStore.getState().removeDrink('nope')).toBeNull();
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
  });

  it('removes only the first matching drink when ids collide', () => {
    // Mirrors the screen, where a fixed test uuid can repeat: only one row goes.
    useTallyStore.getState().addDrink(PUB_A, { ...beer(), id: 'dup' });
    useTallyStore.getState().addDrink(PUB_A, { ...beer(), id: 'dup' });
    expect(useTallyStore.getState().removeDrink('dup')).toBe('dup');
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
  });
});

describe('history cap', () => {
  it('keeps at most 50 archived sessions, newest first', () => {
    // 52 sittings at alternating pubs → 51 archived after the 52nd opens.
    for (let i = 0; i < 52; i++) {
      const pub = i % 2 === 0 ? PUB_A : PUB_B;
      useTallyStore.getState().addDrink({ pubKey: `${pub.pubKey}-${i}`, pubName: `Pub ${i}` }, beer());
    }
    const { history } = useTallyStore.getState();
    expect(history.length).toBeLessThanOrEqual(50);
    // Newest archived session is at the front.
    expect(history[0].pubName).toBe('Pub 50');
  });
});

describe('totals + per-beer counts', () => {
  it('sums count and price for the current session', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ priceCzk: 60 }));
    useTallyStore.getState().addDrink(PUB_A, beer({ priceCzk: 45 }));
    const { current } = useTallyStore.getState();
    expect(sessionCount(current)).toBe(2);
    expect(sessionTotalCzk(current)).toBe(105);
  });

  it('counts per beer keyed by normalized name + volume', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ beerName: 'Plzeň', volumeMl: 500 }));
    useTallyStore.getState().addDrink(PUB_A, beer({ beerName: ' plzeň ', volumeMl: 500 }));
    useTallyStore.getState().addDrink(PUB_A, beer({ beerName: 'Plzeň', volumeMl: 300 }));
    const counts = sessionBeerCounts(useTallyStore.getState().current);
    expect(counts.get('plzeň|500')).toBe(2);
    expect(counts.get('plzeň|300')).toBe(1);
  });

  it('totals are 0 for a null session', () => {
    expect(sessionCount(null)).toBe(0);
    expect(sessionTotalCzk(null)).toBe(0);
    expect(sessionBeerCounts(null).size).toBe(0);
  });
});

describe('reset', () => {
  it('clears current and history', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().addDrink(PUB_B, beer());
    useTallyStore.getState().reset();
    expect(useTallyStore.getState().current).toBeNull();
    expect(useTallyStore.getState().history).toHaveLength(0);
  });

  it('retracts each wiped session from the backend by its clientId', () => {
    deleteVisitByClientId.mockClear();
    useTallyStore.getState().addDrink(PUB_A, beer());
    const curId = useTallyStore.getState().current?.clientId;
    useTallyStore.getState().reset();
    expect(deleteVisitByClientId).toHaveBeenCalledWith(curId);
  });
});

describe('clientId', () => {
  it('mints a stable clientId when a session is opened', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    expect(useTallyStore.getState().current?.clientId).toBeTruthy();
  });

  it('keeps the same clientId as the session grows', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    const id = useTallyStore.getState().current?.clientId;
    useTallyStore.getState().addDrink(PUB_A, beer());
    expect(useTallyStore.getState().current?.clientId).toBe(id);
  });
});

describe('migrateTally — v0 → v1 backfills clientId', () => {
  it('mints a clientId for the current and every history session', () => {
    const v0 = {
      current: { pubKey: 'aaaaaaaa', pubName: 'A', startedAt: 't', drinks: [] },
      history: [
        { pubKey: 'bbbbbbbb', pubName: 'B', startedAt: 't2', drinks: [] },
        { pubKey: 'cccccccc', pubName: 'C', startedAt: 't3', drinks: [] },
      ],
    };
    const migrated = migrateTally(v0, 0);
    expect(migrated.current?.clientId).toBeTruthy();
    expect(migrated.history.every((s) => !!s.clientId)).toBe(true);
    // Distinct ids.
    const ids = [migrated.current!.clientId, ...migrated.history.map((s) => s.clientId)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('passes already-current (v1) state through untouched', () => {
    const v1 = { current: null, history: [] };
    expect(migrateTally(v1, 1)).toBe(v1);
  });

  it('tolerates missing input', () => {
    const migrated = migrateTally(undefined, 0);
    expect(migrated.current).toBeNull();
    expect(migrated.history).toEqual([]);
  });
});
