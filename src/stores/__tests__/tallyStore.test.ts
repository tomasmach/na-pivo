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
  isPastEveningBackdate,
  sessionCount,
  sessionTotalCzk,
  sessionBeerCounts,
  sessionDrinkCount,
  sessionDrinkTypeCounts,
  sessionLastActivityMs,
  resumableSession,
  IDLE_TIMEOUT_MS,
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

  it('moves startedAt back when a same-day backdate predates the session start', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T21:00:00' }));
    // "Před dvěma hodinami" — same drinking day, but earlier than the first count.
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T19:00:00' }));
    const { current } = useTallyStore.getState();
    expect(current?.drinks).toHaveLength(2);
    expect(current?.startedAt).toBe('2026-06-12T19:00:00');
  });

  it('refreshes the pub name within an ongoing session', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().addDrink({ ...PUB_A, pubName: 'U Zlatého Tygra (přejmenováno)' }, beer());
    expect(useTallyStore.getState().current?.pubName).toBe('U Zlatého Tygra (přejmenováno)');
  });
});

describe('isPastEveningBackdate (backdate routing)', () => {
  it('is false for a same-drinking-day backdate ("před hodinou")', () => {
    const now = new Date('2026-06-13T21:00:00');
    expect(isPastEveningBackdate('2026-06-13T20:00:00', now)).toBe(false);
  });

  it('keeps a post-midnight backdate on the same drinking day (before 04:00 cutoff)', () => {
    const now = new Date('2026-06-13T02:30:00');
    // 01:00 and 02:30 both belong to the 06-12 drinking day (04:00 cutoff).
    expect(isPastEveningBackdate('2026-06-13T01:00:00', now)).toBe(false);
  });

  it('is true for a backdate that lands on an earlier drinking day (yesterday)', () => {
    const now = new Date('2026-06-13T21:00:00');
    expect(isPastEveningBackdate('2026-06-12T20:00:00', now)).toBe(true);
  });
});

describe('addBackdatedDrink', () => {
  it('files a past-day backdate into history with no live session, leaving current null', () => {
    // No current session at all (the routing bug: addDrink would make yesterday current).
    const landed = useTallyStore.getState().addBackdatedDrink(PUB_A, beer({ at: '2026-06-12T20:00:00' }));
    const { current, history } = useTallyStore.getState();
    expect(current).toBeNull();
    expect(history).toHaveLength(1);
    expect(history[0].drinks).toHaveLength(1);
    expect(history[0].archivedReason).toBe('manual');
    expect(landed).toBe(history[0]);
  });

  it('files a backdate to another day into a new past evening, leaving the live session untouched', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-13T20:00:00' }));
    const before = useTallyStore.getState().current;
    const landed = useTallyStore.getState().addBackdatedDrink(PUB_A, beer({ at: '2026-06-12T20:00:00' }));
    const { current, history } = useTallyStore.getState();
    // The live evening is exactly as it was — not clobbered by the rollover.
    expect(current).toBe(before);
    expect(current?.drinks).toHaveLength(1);
    // The backdated drink lives in a fresh archived evening.
    expect(history).toHaveLength(1);
    expect(history[0].drinks).toHaveLength(1);
    expect(history[0].archivedReason).toBe('manual');
    expect(landed).toBe(history[0]);
  });

  it('appends a backdate into the matching archived evening (same pub + drinking day)', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T20:00:00' }));
    // Rolls the day over: yesterday archived, today live.
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-13T20:00:00' }));
    expect(useTallyStore.getState().history).toHaveLength(1);

    const landed = useTallyStore.getState().addBackdatedDrink(PUB_A, beer({ at: '2026-06-12T22:00:00' }));
    const { history } = useTallyStore.getState();
    expect(history).toHaveLength(1);
    expect(history[0].drinks).toHaveLength(2);
    expect(landed.drinks).toHaveLength(2);
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

describe('removeDrinkFromSession', () => {
  it('removes a drink from an archived evening and reports the session id', () => {
    useTallyStore.getState().addDrink(PUB_A, beer()); // id-1
    const sessionClientId = useTallyStore.getState().current?.clientId as string;
    const startedAt = useTallyStore.getState().current?.startedAt as string;
    useTallyStore.getState().archiveCurrent('manual');

    const removed = useTallyStore.getState().removeDrinkFromSession(startedAt, 'id-1');

    expect(removed).toEqual({ drinkId: 'id-1', sessionClientId, remainingDrinks: 0 });
    expect(useTallyStore.getState().history).toHaveLength(0);
  });

  it('keeps the evening when other drinks remain', () => {
    useTallyStore.getState().addDrink(PUB_A, beer()); // id-1
    useTallyStore.getState().addDrink(PUB_A, beer()); // id-2
    const startedAt = useTallyStore.getState().current?.startedAt as string;
    useTallyStore.getState().archiveCurrent('manual');

    const removed = useTallyStore.getState().removeDrinkFromSession(startedAt, 'id-1');

    expect(removed?.remainingDrinks).toBe(1);
    expect(useTallyStore.getState().history[0].drinks.map((drink) => drink.id)).toEqual(['id-2']);
  });

  it('returns null for an unknown drink in the selected evening', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    const startedAt = useTallyStore.getState().current?.startedAt as string;
    expect(useTallyStore.getState().removeDrinkFromSession(startedAt, 'missing')).toBeNull();
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
  });
});

describe('updateDrinkNameInSession', () => {
  it('renames a drink in the current session', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ beerName: 'Plzen' }));
    const startedAt = useTallyStore.getState().current?.startedAt as string;

    expect(useTallyStore.getState().updateDrinkNameInSession(startedAt, 'id-1', ' Plzeň ')).toBe(true);

    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Plzeň');
  });

  it('renames a drink in an archived evening', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ beerName: 'Plzen' }));
    const startedAt = useTallyStore.getState().current?.startedAt as string;
    useTallyStore.getState().archiveCurrent('manual');

    expect(useTallyStore.getState().updateDrinkNameInSession(startedAt, 'id-1', 'Plzeň')).toBe(true);

    expect(useTallyStore.getState().history[0].drinks[0].beerName).toBe('Plzeň');
  });

  it('rejects an empty name and leaves the drink untouched', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ beerName: 'Plzeň' }));
    const startedAt = useTallyStore.getState().current?.startedAt as string;

    expect(useTallyStore.getState().updateDrinkNameInSession(startedAt, 'id-1', '   ')).toBe(false);

    expect(useTallyStore.getState().current?.drinks[0].beerName).toBe('Plzeň');
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

  it('keeps non-beers in the evening total but out of beer counts', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ beerName: 'Plzeň', priceCzk: 62 }));
    useTallyStore.getState().addDrink(PUB_A, {
      ...beer({ beerName: 'Kofola', priceCzk: 49, volumeMl: 400 }),
      drinkType: 'soft_drink',
    });
    useTallyStore.getState().addDrink(PUB_A, {
      ...beer({ beerName: 'Slivovice', priceCzk: 65, volumeMl: 40 }),
      drinkType: 'shot',
    });
    const { current } = useTallyStore.getState();

    expect(sessionCount(current)).toBe(1);
    expect(sessionDrinkCount(current)).toBe(3);
    expect(sessionTotalCzk(current)).toBe(176);
    expect(sessionDrinkTypeCounts(current)).toEqual({ beer: 1, soft_drink: 1, shot: 1 });
    expect(sessionBeerCounts(current).has('kofola|400')).toBe(false);
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

describe('idle detection', () => {
  it('sessionLastActivityMs reports the latest counted beer', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T19:00:00' }));
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T20:30:00' }));
    const ms = sessionLastActivityMs(useTallyStore.getState().current!);
    expect(ms).toBe(Date.parse('2026-06-12T20:30:00'));
  });
});

describe('maybeAutoArchive', () => {
  it('archives an idle session with reason "timeout" and clears current', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T19:00:00' }));
    const archived = useTallyStore.getState().maybeAutoArchive(
      Date.parse('2026-06-12T19:00:00') + IDLE_TIMEOUT_MS,
    );
    expect(archived).toBe(true);
    const { current, history } = useTallyStore.getState();
    expect(current).toBeNull();
    expect(history).toHaveLength(1);
    expect(history[0].archivedReason).toBe('timeout');
    expect(history[0].drinks).toHaveLength(1);
  });

  it('leaves a still-active session untouched', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T19:00:00' }));
    const archived = useTallyStore.getState().maybeAutoArchive(
      Date.parse('2026-06-12T19:00:00') + IDLE_TIMEOUT_MS - 1,
    );
    expect(archived).toBe(false);
    expect(useTallyStore.getState().current?.drinks).toHaveLength(1);
    expect(useTallyStore.getState().history).toHaveLength(0);
  });

  it('is a no-op when there is no session', () => {
    expect(useTallyStore.getState().maybeAutoArchive(Date.now())).toBe(false);
    expect(useTallyStore.getState().history).toHaveLength(0);
  });
});

describe('archiveCurrent (Dopito)', () => {
  it('archives the current session with the given reason and clears it', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().archiveCurrent('manual');
    const { current, history } = useTallyStore.getState();
    expect(current).toBeNull();
    expect(history).toHaveLength(1);
    expect(history[0].archivedReason).toBe('manual');
  });

  it('drops an empty pinned session without archiving it', () => {
    useTallyStore.getState().addDrink(PUB_A, beer());
    useTallyStore.getState().undoLast(); // session object stays, but empty
    useTallyStore.getState().archiveCurrent('manual');
    expect(useTallyStore.getState().current).toBeNull();
    expect(useTallyStore.getState().history).toHaveLength(0);
  });
});

describe('resumeLast', () => {
  // Open a session, then auto-archive it as a timeout so it is resumable.
  function openThenTimeout(at: string) {
    useTallyStore.getState().addDrink(PUB_A, beer({ at }));
    useTallyStore.getState().maybeAutoArchive(Date.parse(at) + IDLE_TIMEOUT_MS);
  }

  it('pops a same-pub, same-day timeout evening back to current without the reason flag', () => {
    openThenTimeout('2026-06-12T19:00:00');
    const archivedClientId = useTallyStore.getState().history[0].clientId;

    const resumed = useTallyStore.getState().resumeLast(PUB_A.pubKey, Date.parse('2026-06-12T22:30:00'));
    expect(resumed).toBe(true);
    const { current, history } = useTallyStore.getState();
    expect(history).toHaveLength(0);
    expect(current?.clientId).toBe(archivedClientId); // same backend visit
    expect(current?.drinks).toHaveLength(1);
    expect(current?.archivedReason).toBeUndefined();
  });

  it('refuses to resume an evening at a different pub', () => {
    openThenTimeout('2026-06-12T19:00:00');
    const resumed = useTallyStore.getState().resumeLast(PUB_B.pubKey, Date.parse('2026-06-12T22:30:00'));
    expect(resumed).toBe(false);
    expect(useTallyStore.getState().history).toHaveLength(1);
  });

  it('refuses to resume across the drinking-day boundary', () => {
    openThenTimeout('2026-06-12T19:00:00');
    const resumed = useTallyStore.getState().resumeLast(PUB_A.pubKey, Date.parse('2026-06-13T20:00:00'));
    expect(resumed).toBe(false);
  });

  it('refuses to resume a rollover archive (pub change), only a timeout', () => {
    useTallyStore.getState().addDrink(PUB_A, beer({ at: '2026-06-12T19:00:00' }));
    useTallyStore.getState().addDrink(PUB_B, beer({ at: '2026-06-12T19:30:00' })); // archives PUB_A as 'pub-change'
    expect(useTallyStore.getState().history[0].archivedReason).toBe('pub-change');
    // Empty PUB_A again would need to be current=null; force the resumable check directly.
    const resumed = useTallyStore.getState().resumeLast(PUB_A.pubKey, Date.parse('2026-06-12T20:00:00'));
    expect(resumed).toBe(false);
  });
});

describe('resumableSession', () => {
  const archived: TallySession = {
    clientId: 'c1',
    pubKey: PUB_A.pubKey,
    pubName: PUB_A.pubName,
    startedAt: '2026-06-12T19:00:00',
    drinks: [{ id: 'd1', beerName: 'Plzeň', priceCzk: 50, at: '2026-06-12T19:00:00' }],
    archivedReason: 'timeout',
  };
  const now = Date.parse('2026-06-12T22:00:00');

  it('returns the newest timeout evening at the same pub on the same day', () => {
    expect(resumableSession(null, [archived], PUB_A.pubKey, now)).toBe(archived);
  });

  it('is suppressed while a live session is in progress', () => {
    const live: TallySession = { ...archived, clientId: 'live', archivedReason: undefined };
    expect(resumableSession(live, [archived], PUB_A.pubKey, now)).toBeNull();
  });

  it('returns null for a non-timeout reason or a different pub', () => {
    expect(resumableSession(null, [{ ...archived, archivedReason: 'manual' }], PUB_A.pubKey, now)).toBeNull();
    expect(resumableSession(null, [archived], PUB_B.pubKey, now)).toBeNull();
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
