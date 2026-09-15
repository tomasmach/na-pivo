import {
  dailyBeerAverage,
  earliestTimestamp,
  formatDailyBeerAverage,
} from '../dailyBeerAverage';

describe('dailyBeerAverage', () => {
  it('counts the first 24 hours as day one', () => {
    expect(
      dailyBeerAverage(3, '2026-07-20T18:00:00.000Z', new Date('2026-07-21T17:59:00.000Z')),
    ).toBe(3);
  });

  it('includes every elapsed 24-hour day since the first beer', () => {
    expect(
      dailyBeerAverage(6, '2026-07-18T12:00:00.000Z', new Date('2026-07-21T12:00:00.000Z')),
    ).toBe(1.5);
  });

  it('shows zero before the first beer and unknown when its date is missing', () => {
    expect(dailyBeerAverage(0, null)).toBe(0);
    expect(dailyBeerAverage(2, null)).toBeNull();
  });

  it('formats the result with a Czech decimal comma', () => {
    expect(formatDailyBeerAverage(0.36)).toBe('0,4');
    expect(formatDailyBeerAverage(0)).toBe('0');
    expect(formatDailyBeerAverage(null)).toBe('—');
  });
});

describe('earliestTimestamp', () => {
  it('chooses the earliest valid local or remote timestamp', () => {
    expect(
      earliestTimestamp([
        null,
        'not-a-date',
        '2026-07-20T12:00:00.000Z',
        '2026-07-18T12:00:00.000Z',
      ]),
    ).toBe('2026-07-18T12:00:00.000Z');
  });
});
