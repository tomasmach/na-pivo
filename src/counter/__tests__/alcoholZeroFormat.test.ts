import { formatZeroAtShort } from '@/counter/useAlcoholEstimate';

describe('formatZeroAtShort', () => {
  const now = new Date(2026, 9, 19, 20, 0).getTime();

  it('names the day once the zero is more than a day away', () => {
    expect(formatZeroAtShort(new Date(2026, 9, 19, 23, 30), now)).toBe('23:30');
    expect(formatZeroAtShort(new Date(2026, 9, 20, 12, 30), now)).toBe('zítra 12:30');
    expect(formatZeroAtShort(new Date(2026, 9, 21, 12, 30), now)).toBe('21. 10. kolem 12:30');
  });
});
