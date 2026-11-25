import { earliestTimestamp } from '../dailyBeerAverage';

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
