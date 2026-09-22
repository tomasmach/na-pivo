import {
  FOREGROUND_PULL_MIN_INTERVAL_MS,
  pulledRecently,
  resetForegroundPullsForTests,
  trackForegroundPull,
} from '../foregroundPulls';

const T0 = 1_800_000_000_000;

beforeEach(() => {
  resetForegroundPullsForTests();
});

function account(id: string | null) {
  return () => id;
}

it('skips a pull that succeeded within the interval for the same account', async () => {
  await trackForegroundPull('ratings', async () => true, account('acc-1'), () => T0);

  expect(pulledRecently('ratings', 'acc-1', T0 + 60_000)).toBe(true);
  expect(pulledRecently('ratings', 'acc-1', T0 + FOREGROUND_PULL_MIN_INTERVAL_MS)).toBe(false);
});

it('does not record a failed or rejected pull, so the next foreground retries', async () => {
  await trackForegroundPull('diary', async () => false, account('acc-1'), () => T0);
  await expect(
    trackForegroundPull('amenities', () => Promise.reject(new Error('offline')), account('acc-1'), () => T0),
  ).resolves.toBe(false);

  expect(pulledRecently('diary', 'acc-1', T0 + 1_000)).toBe(false);
  expect(pulledRecently('amenities', 'acc-1', T0 + 1_000)).toBe(false);
});

it('keeps accounts and pull kinds independent', async () => {
  await trackForegroundPull('diary', async () => true, account('acc-1'), () => T0);

  expect(pulledRecently('diary', 'acc-2', T0 + 1_000)).toBe(false);
  expect(pulledRecently('ratings', 'acc-1', T0 + 1_000)).toBe(false);
});

it('adopts the account hydrated during a launch pull but not a switched one', async () => {
  let current: string | null = null;
  await trackForegroundPull(
    'ratings',
    async () => {
      current = 'acc-1';
      return true;
    },
    () => current,
    () => T0,
  );
  expect(pulledRecently('ratings', 'acc-1', T0 + 1_000)).toBe(true);

  await trackForegroundPull(
    'diary',
    async () => {
      current = 'acc-2';
      return true;
    },
    () => current,
    () => T0,
  );
  expect(pulledRecently('diary', 'acc-1', T0 + 1_000)).toBe(false);
  expect(pulledRecently('diary', 'acc-2', T0 + 1_000)).toBe(false);
});

it('never blocks without a known account or after the clock moved back', async () => {
  await trackForegroundPull('addedPubs', async () => true, account(null), () => T0);
  expect(pulledRecently('addedPubs', null, T0)).toBe(false);

  await trackForegroundPull('addedPubs', async () => true, account('acc-1'), () => T0);
  expect(pulledRecently('addedPubs', 'acc-1', T0 - 1_000)).toBe(false);
});
