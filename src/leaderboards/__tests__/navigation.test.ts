import { resolveInitialLeaderboardPeriod } from '@/leaderboards/navigation';

describe('resolveInitialLeaderboardPeriod', () => {
  it('opens the lifetime board from the lifetime profile total', () => {
    expect(resolveInitialLeaderboardPeriod(undefined, 'profile')).toBe('all');
  });

  it('keeps weekly competition entry points on the weekly board', () => {
    expect(resolveInitialLeaderboardPeriod(undefined, 'counter')).toBe('week');
    expect(resolveInitialLeaderboardPeriod(undefined, 'parta')).toBe('week');
  });

  it('honours an explicit valid period and ignores invalid values', () => {
    expect(resolveInitialLeaderboardPeriod('year', 'profile')).toBe('year');
    expect(resolveInitialLeaderboardPeriod('invalid', 'profile')).toBe('all');
  });
});
