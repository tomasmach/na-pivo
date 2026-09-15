jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { buildNightSummary, nightHours, sessionsOfNight, tallyGroups } from '../nightModel';
import type { TallySession } from '@/stores/tallyStore';

let idSeq = 0;
function drink(at: string, drinkType?: 'beer' | 'wine' | 'soft_drink' | 'shot') {
  idSeq += 1;
  return { id: `d-${idSeq}`, beerName: 'Pilsner Urquell', at, drinkType };
}

function session(over: Partial<TallySession>): TallySession {
  idSeq += 1;
  return {
    clientId: `s-${idSeq}`,
    pubKey: 'u2fkbnhq',
    pubName: 'U Zlatého tygra',
    startedAt: '2026-06-14T19:00:00.000Z',
    drinks: [],
    ...over,
  };
}

describe('tallyGroups', () => {
  it('splits into groups of five with a remainder', () => {
    expect(tallyGroups(12)).toEqual({ groups: [5, 5, 2], overflow: 0 });
  });

  it('caps drawn marks and reports overflow', () => {
    expect(tallyGroups(40, 25)).toEqual({ groups: [5, 5, 5, 5, 5], overflow: 15 });
  });

  it('handles zero', () => {
    expect(tallyGroups(0)).toEqual({ groups: [], overflow: 0 });
  });
});

describe('nightHours', () => {
  it('rounds to whole hours with a floor of one past thirty minutes', () => {
    expect(nightHours(undefined)).toBe(0);
    expect(nightHours(20)).toBe(0);
    expect(nightHours(40)).toBe(1);
    expect(nightHours(200)).toBe(3);
  });
});

describe('buildNightSummary', () => {
  it('merges a pub crawl into one night', () => {
    const first = session({
      pubName: 'U Zlatého tygra',
      pubCity: 'Praha',
      startedAt: '2026-06-14T18:00:00.000Z',
      drinks: [drink('2026-06-14T18:10:00.000Z'), drink('2026-06-14T19:00:00.000Z')],
    });
    const second = session({
      pubKey: 'u2fkbnhz',
      pubName: 'Lokál Dlouhá',
      startedAt: '2026-06-14T20:00:00.000Z',
      drinks: [drink('2026-06-14T21:30:00.000Z', 'beer'), drink('2026-06-14T21:40:00.000Z', 'shot')],
    });

    const summary = buildNightSummary([first, second]);
    expect(summary).not.toBeNull();
    expect(summary?.clientKey).toBe('night-2026-06-14');
    expect(summary?.beerCount).toBe(3);
    expect(summary?.shotCount).toBe(1);
    expect(summary?.pubNames).toEqual(['U Zlatého tygra', 'Lokál Dlouhá']);
    expect(summary?.city).toBe('Praha');
    expect(summary?.startedAt).toBe('2026-06-14T18:00:00.000Z');
    expect(summary?.endedAt).toBe('2026-06-14T21:40:00.000Z');
    expect(summary?.durationMinutes).toBe(220);
  });

  it('excludes outside sittings from pub names but keeps their drinks', () => {
    const home = session({
      pubKey: 'ctx:private',
      pubName: 'Doma',
      startedAt: '2026-06-14T17:00:00.000Z',
      drinks: [drink('2026-06-14T17:05:00.000Z')],
    });
    const summary = buildNightSummary([home]);
    expect(summary?.beerCount).toBe(1);
    expect(summary?.pubNames).toEqual([]);
  });

  it('returns null for an empty night', () => {
    expect(buildNightSummary([])).toBeNull();
    expect(buildNightSummary([session({ drinks: [] })])).toBeNull();
  });
});

describe('sessionsOfNight', () => {
  it('groups by the 04:00 drinking day across current and history', () => {
    const lateNight = session({
      startedAt: '2026-06-15T01:30:00.000Z',
      drinks: [drink('2026-06-15T01:35:00.000Z')],
    });
    const evening = session({
      startedAt: '2026-06-14T19:00:00.000Z',
      drinks: [drink('2026-06-14T19:05:00.000Z')],
    });
    const otherDay = session({
      startedAt: '2026-06-10T19:00:00.000Z',
      drinks: [drink('2026-06-10T19:05:00.000Z')],
    });

    const picked = sessionsOfNight(lateNight, [evening, otherDay], '2026-06-14');
    expect(picked.map((s) => s.startedAt)).toEqual([
      '2026-06-14T19:00:00.000Z',
      '2026-06-15T01:30:00.000Z',
    ]);
  });
});
