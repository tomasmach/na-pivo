import {
  sessionBreakdown,
  sessionDrinkActionGroups,
  drinkingDaysBetween,
  eveningDayRelation,
  formatEveningDate,
  eveningDateLabel,
  sessionDrinkSummary,
} from '../eveningModel';
import type { TallySession } from '@/stores/tallyStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

let idSeq = 0;
function drink(over: Partial<{ beerName: string; priceCzk: number; volumeMl: number; at: string; drinkType: 'beer' | 'soft_drink' | 'shot'; servingType: 'draft' | 'bottle' }> = {}) {
  idSeq += 1;
  return {
    id: `id-${idSeq}`,
    beerName: over.beerName ?? 'Pilsner Urquell',
    priceCzk: over.priceCzk ?? 62,
    volumeMl: over.volumeMl,
    at: over.at ?? '2026-06-14T19:00:00.000Z',
    drinkType: over.drinkType,
    servingType: over.servingType,
  };
}

function session(drinks: ReturnType<typeof drink>[], over: Partial<TallySession> = {}): TallySession {
  return {
    clientId: over.clientId ?? 'visit-aaaaaaaa',
    pubKey: over.pubKey ?? 'aaaaaaaa',
    pubName: over.pubName ?? 'U Zlatého tygra',
    startedAt: over.startedAt ?? drinks[0]?.at ?? '2026-06-14T19:00:00.000Z',
    drinks: drinks.map((d) => {
      const out: TallySession['drinks'][number] = {
        id: d.id,
        beerName: d.beerName,
        priceCzk: d.priceCzk,
        at: d.at,
      };
      if (d.drinkType && d.drinkType !== 'beer') out.drinkType = d.drinkType;
      if (typeof d.volumeMl === 'number') out.volumeMl = d.volumeMl;
      if (d.servingType) out.servingType = d.servingType;
      return out;
    }),
  };
}

beforeEach(() => {
  idSeq = 0;
});

describe('sessionBreakdown', () => {
  it('returns [] for a null session', () => {
    expect(sessionBreakdown(null)).toEqual([]);
  });

  it('groups by beer name + volume and sums prices', () => {
    const s = session([
      drink({ beerName: 'Pilsner Urquell', priceCzk: 62, volumeMl: 500 }),
      drink({ beerName: 'Pilsner Urquell', priceCzk: 62, volumeMl: 500 }),
      drink({ beerName: 'Kozel', priceCzk: 45, volumeMl: 500 }),
    ]);
    const lines = sessionBreakdown(s);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: 'Pilsner Urquell', volumeMl: 500, count: 2, totalCzk: 124 });
    expect(lines[1]).toMatchObject({ name: 'Kozel', volumeMl: 500, count: 1, totalCzk: 45 });
  });

  it('treats different volumes of the same beer as separate lines', () => {
    const s = session([
      drink({ beerName: 'Pilsner', volumeMl: 300 }),
      drink({ beerName: 'Pilsner', volumeMl: 500 }),
    ]);
    expect(sessionBreakdown(s)).toHaveLength(2);
  });

  it('preserves the first-seen display name regardless of case', () => {
    const s = session([
      drink({ beerName: 'Kozel', volumeMl: 500 }),
      drink({ beerName: 'kozel', volumeMl: 500 }),
    ]);
    const lines = sessionBreakdown(s);
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe('Kozel');
    expect(lines[0].count).toBe(2);
  });

  it('keeps first-appearance order', () => {
    const s = session([
      drink({ beerName: 'Kozel' }),
      drink({ beerName: 'Pilsner' }),
    ]);
    expect(sessionBreakdown(s).map((l) => l.name)).toEqual(['Kozel', 'Pilsner']);
  });

  it('separates identical names across categories and builds a mixed summary', () => {
    const s = session([
      drink({ beerName: 'Birell', drinkType: 'beer' }),
      drink({ beerName: 'Birell', drinkType: 'soft_drink' }),
      drink({ beerName: 'Slivovice', drinkType: 'shot' }),
      drink({ beerName: 'Slivovice', drinkType: 'shot' }),
    ]);

    expect(sessionBreakdown(s).map((line) => line.drinkType)).toEqual([
      'beer',
      'soft_drink',
      'shot',
    ]);
    expect(sessionDrinkSummary(s)).toBe('1 pivo · 1 nealko · 2 panáky');
  });
});

describe('sessionDrinkActionGroups', () => {
  it('collapses repeated drinks into one editable row with a count and total', () => {
    const groups = sessionDrinkActionGroups(
      session([
        drink({ beerName: 'Pilsner Urquell', priceCzk: 74, volumeMl: 500 }),
        drink({ beerName: ' pilsner urquell ', priceCzk: 74, volumeMl: 500 }),
        drink({ beerName: 'Pilsner Urquell', priceCzk: 76, volumeMl: 500 }),
      ]),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      name: 'Pilsner Urquell',
      count: 3,
      totalCzk: 224,
      volumeMl: 500,
    });
    expect(groups[0].drinks).toHaveLength(3);
  });

  it('keeps different volumes, drink types and serving types on separate rows', () => {
    const draft = drink({ beerName: 'Kozel', priceCzk: 55, volumeMl: 500, servingType: 'draft' });
    const bottle = drink({ beerName: 'Kozel', priceCzk: 55, volumeMl: 500, servingType: 'bottle' });
    const small = drink({ beerName: 'Kozel', priceCzk: 45, volumeMl: 300 });
    const softDrink = drink({ beerName: 'Kozel', priceCzk: 45, volumeMl: 500, drinkType: 'soft_drink' });

    expect(sessionDrinkActionGroups(session([draft, bottle, small, softDrink]))).toHaveLength(4);
  });
});

describe('drinking-day date helpers', () => {
  // Built from LOCAL date components so the 04:00 cutoff math is deterministic
  // regardless of the machine timezone.
  const now = new Date(2026, 5, 14, 20, 0, 0); // 14 Jun 2026, 20:00 local

  it('drinkingDaysBetween counts whole drinking days', () => {
    const yesterday = new Date(2026, 5, 13, 20, 0, 0);
    expect(drinkingDaysBetween(yesterday, now)).toBe(1);
    expect(drinkingDaysBetween(now, now)).toBe(0);
  });

  it('classifies today / yesterday / older', () => {
    const today = new Date(2026, 5, 14, 19, 0, 0).toISOString();
    const yesterday = new Date(2026, 5, 13, 19, 0, 0).toISOString();
    const older = new Date(2026, 5, 10, 19, 0, 0).toISOString();
    expect(eveningDayRelation(today, now)).toBe('today');
    expect(eveningDayRelation(yesterday, now)).toBe('yesterday');
    expect(eveningDayRelation(older, now)).toBe('older');
  });

  it('puts a post-midnight (pre-04:00) beer on the previous drinking day', () => {
    const lateNight = new Date(2026, 5, 14, 1, 30, 0).toISOString(); // 01:30 belongs to 13 Jun
    expect(eveningDayRelation(lateNight, now)).toBe('yesterday');
    expect(formatEveningDate(lateNight, now)).toBe('13. 6.');
  });

  it('formats the date without the year for the current year', () => {
    const d = new Date(2026, 5, 12, 19, 0, 0).toISOString();
    expect(formatEveningDate(d, now)).toBe('12. 6.');
  });

  it('includes the year for a previous year', () => {
    const d = new Date(2025, 10, 3, 19, 0, 0).toISOString(); // 3 Nov 2025
    expect(formatEveningDate(d, now)).toBe('3. 11. 2025');
  });

  it('eveningDateLabel uses Dnes / Včera / numeric', () => {
    const today = new Date(2026, 5, 14, 19, 0, 0).toISOString();
    const yesterday = new Date(2026, 5, 13, 19, 0, 0).toISOString();
    const older = new Date(2026, 5, 10, 19, 0, 0).toISOString();
    expect(eveningDateLabel(today, now)).toBe('Dnes');
    expect(eveningDateLabel(yesterday, now)).toBe('Včera');
    expect(eveningDateLabel(older, now)).toBe('10. 6.');
  });
});
