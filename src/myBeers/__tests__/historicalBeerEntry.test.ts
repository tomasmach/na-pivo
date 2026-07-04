import {
  buildHistoricalCheckedInAt,
  buildHistoricalInterval,
  formatHistoricalDate,
  formatHistoricalTime,
} from '@/myBeers/historicalBeerEntry';

describe('historical beer entry date helpers', () => {
  it('builds an ISO timestamp from Czech date and time inputs', () => {
    const result = buildHistoricalCheckedInAt(
      '12. 06. 2026',
      '19:45',
      new Date('2026-07-04T12:00:00.000Z'),
    );

    expect(result?.iso).toBe(new Date(2026, 5, 12, 19, 45, 0, 0).toISOString());
  });

  it('rejects invalid calendar dates and future dates', () => {
    const now = new Date('2026-07-04T12:00:00.000Z');

    expect(buildHistoricalCheckedInAt('31. 02. 2026', '19:45', now)).toBeNull();
    expect(buildHistoricalCheckedInAt('12. 06. 2026', '25:00', now)).toBeNull();
    expect(buildHistoricalCheckedInAt('05. 07. 2026', '19:45', now)).toBeNull();
  });

  it('builds optional end time and carries it over midnight', () => {
    const sameDay = buildHistoricalInterval(
      '12. 06. 2026',
      '19:45',
      '22:30',
      new Date('2026-07-04T12:00:00.000Z'),
    );
    expect(sameDay?.iso).toBe(new Date(2026, 5, 12, 19, 45, 0, 0).toISOString());
    expect(sameDay?.endedIso).toBe(new Date(2026, 5, 12, 22, 30, 0, 0).toISOString());

    const afterMidnight = buildHistoricalInterval(
      '12. 06. 2026',
      '22:15',
      '01:20',
      new Date('2026-07-04T12:00:00.000Z'),
    );
    expect(afterMidnight?.endedIso).toBe(new Date(2026, 5, 13, 1, 20, 0, 0).toISOString());
  });

  it('rejects invalid or future end time', () => {
    const now = new Date(2026, 6, 4, 20, 0, 0, 0);

    expect(buildHistoricalInterval('04. 07. 2026', '19:00', '25:00', now)).toBeNull();
    expect(buildHistoricalInterval('04. 07. 2026', '19:00', '20:30', now)).toBeNull();
  });

  it('formats default values for the sheet', () => {
    const date = new Date(2026, 6, 4, 20, 5, 0, 0);

    expect(formatHistoricalDate(date)).toMatch(/04\.?\s*07\.?\s*2026|4\.?\s*7\.?\s*2026/);
    expect(formatHistoricalTime(date)).toContain('20');
    expect(formatHistoricalTime(date)).toContain('05');
  });
});
