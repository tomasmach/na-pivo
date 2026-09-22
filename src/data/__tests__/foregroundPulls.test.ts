import {
  ALL_FOREGROUND_PULLS,
  FOREGROUND_PULL_MIN_INTERVAL_MS,
  claimForegroundPull,
  markForegroundPulls,
  resetForegroundPullsForTests,
} from '../foregroundPulls';

const T0 = 1_800_000_000_000;

beforeEach(() => {
  resetForegroundPullsForTests();
});

it('runs a pull once per interval for the same account', () => {
  expect(claimForegroundPull('ratings', 'acc-1', T0)).toBe(true);
  expect(claimForegroundPull('ratings', 'acc-1', T0 + 60_000)).toBe(false);
  expect(claimForegroundPull('ratings', 'acc-1', T0 + FOREGROUND_PULL_MIN_INTERVAL_MS)).toBe(true);
});

it('pulls immediately for a different account and keeps pulls independent', () => {
  expect(claimForegroundPull('diary', 'acc-1', T0)).toBe(true);
  expect(claimForegroundPull('diary', 'acc-2', T0 + 1_000)).toBe(true);
  expect(claimForegroundPull('amenities', 'acc-1', T0 + 1_000)).toBe(true);
});

it('treats a cold-start pull as recent', () => {
  markForegroundPulls('acc-1', ALL_FOREGROUND_PULLS, T0);
  for (const pull of ALL_FOREGROUND_PULLS) {
    expect(claimForegroundPull(pull, 'acc-1', T0 + 30_000)).toBe(false);
  }
});

it('never blocks without a known account or after the clock moved back', () => {
  expect(claimForegroundPull('push', null, T0)).toBe(true);
  expect(claimForegroundPull('push', null, T0)).toBe(true);
  expect(claimForegroundPull('push', 'acc-1', T0)).toBe(true);
  expect(claimForegroundPull('push', 'acc-1', T0 - 1_000)).toBe(true);
});
