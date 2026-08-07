import {
  buildProfileDiary,
  computeProfileRecords,
  computeProfileSeries,
  computeProfileStreak,
  type ProfileDiaryEntry,
} from '../profileStats';

function entry(
  id: string,
  at: string,
  pubKey: string,
  pubName: string,
): ProfileDiaryEntry {
  return { id, at, pubKey, pubName, isBeer: true };
}

describe('profileStats', () => {
  it('does not re-add a suspect remote drink from the matching local row', () => {
    const local = {
      clientId: 'night-1',
      pubKey: 'pub-a',
      pubName: 'U Áčka',
      startedAt: '2026-08-06T20:00:00+02:00',
      drinks: [
        { id: 'same-drink', beerName: 'Test', at: '2026-08-06T20:00:00+02:00' },
      ],
    };
    const snapshot = {
      visits: [],
      drinks: [
        {
          client_id: 'same-drink',
          cache_key: 'pub-a',
          name: 'U Áčka',
          drink_type: 'beer',
          drank_at: '2026-08-06T20:00:00+02:00',
          is_suspect: true,
        },
      ],
    };

    expect(buildProfileDiary(local, [], snapshot as never)).toEqual([]);
  });

  it('treats all pubs before the 04:00 boundary as one drinking night', () => {
    const entries = [
      entry('a', '2026-08-06T23:00:00+02:00', 'pub-a', 'U Áčka'),
      entry('b', '2026-08-07T01:30:00+02:00', 'pub-b', 'U Béčka'),
      entry('c', '2026-08-07T04:15:00+02:00', 'pub-c', 'U Céčka'),
    ];

    const records = computeProfileRecords(entries);

    expect(records.find((record) => record.id === 'pubs')).toMatchObject({
      value: '2',
      when: '6. 8. · U Áčka → U Béčka',
    });
    expect(records.find((record) => record.id === 'beers')?.value).toBe('2');
  });

  it('keeps the first record-setting night when a later night only ties it', () => {
    const entries = [
      entry('a1', '2026-08-01T19:00:00+02:00', 'pub-a', 'První'),
      entry('a2', '2026-08-01T20:00:00+02:00', 'pub-a', 'První'),
      entry('b1', '2026-08-02T19:00:00+02:00', 'pub-b', 'Druhá'),
      entry('b2', '2026-08-02T20:00:00+02:00', 'pub-b', 'Druhá'),
    ];

    const mostBeers = computeProfileRecords(entries).find((record) => record.id === 'beers');

    expect(mostBeers).toMatchObject({ value: '2', when: '1. 8. · První' });
  });

  it('builds real period totals and consecutive-week streaks', () => {
    const entries = [
      entry('a', '2026-07-27T20:00:00+02:00', 'pub-a', 'A'),
      entry('b', '2026-08-03T20:00:00+02:00', 'pub-b', 'B'),
      entry('c', '2026-08-07T01:00:00+02:00', 'pub-b', 'B'),
    ];
    const now = new Date('2026-08-07T12:00:00+02:00');

    const series = computeProfileSeries(entries, now);
    const streak = computeProfileStreak(entries, now);

    expect(series.Týden.totals.slice(0, 3)).toEqual([
      { label: 'Piv', value: '2' },
      { label: 'Večerů', value: '2' },
      { label: 'Hospod', value: '1' },
    ]);
    expect(streak.current).toBe(2);
    expect(streak.best).toBe(2);
  });
});
