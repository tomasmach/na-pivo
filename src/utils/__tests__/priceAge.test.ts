import {
  isPriceApproximate,
  isPriceFresh,
  priceAgeDays,
  priceAgeLabel,
} from '../priceAge';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-17T12:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

describe('price age contract', () => {
  it('marks prices approximate from six months and expires them after one year', () => {
    expect(isPriceApproximate(daysAgo(179), NOW)).toBe(false);
    expect(isPriceApproximate(daysAgo(180), NOW)).toBe(true);
    expect(isPriceFresh(daysAgo(364), NOW)).toBe(true);
    expect(isPriceFresh(daysAgo(365), NOW)).toBe(false);
  });

  it('formats a relative age and rejects malformed timestamps', () => {
    expect(priceAgeDays(daysAgo(21), NOW)).toBe(21);
    expect(priceAgeLabel(daysAgo(21), NOW)).toBe('před 3 týdny');
    expect(priceAgeDays('not-a-date', NOW)).toBeNull();
    expect(isPriceFresh('not-a-date', NOW)).toBe(false);
  });
});
