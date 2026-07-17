/**
 * Tests for the first-run onboarding store — the decide() launch logic that
 * tells a genuinely fresh install (show the pager) from an upgrade of an
 * existing install (grandfather in silently via the na-pivo-release key) and
 * from a device that already completed the onboarding.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

/**
 * `beforeEach` calls `jest.resetModules()`, so each fresh require binds to a
 * NEW AsyncStorage mock instance (mirrors releaseStore.test).
 */
function currentAsyncStorage() {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default ?? mod;
}

function requireStore() {
  return require('../onboardingStore') as typeof import('../onboardingStore');
}

beforeEach(() => {
  jest.resetModules();
  (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {};
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('useOnboardingStore.decide', () => {
  it('shows the onboarding on a truly fresh install (no persisted keys)', async () => {
    const { useOnboardingStore } = requireStore();

    await useOnboardingStore.getState().decide();

    expect(useOnboardingStore.getState().decision).toBe('show');
    expect(useOnboardingStore.getState().completed).toBe(false);
    expect(useOnboardingStore.getState().firstLaunchSession).toBe(true);
  });

  it('grandfathers in an existing install (na-pivo-release key present)', async () => {
    await currentAsyncStorage().setItem(
      'na-pivo-release',
      JSON.stringify({ state: { lastSeenVersion: '1.4.0' }, version: 0 }),
    );
    const { useOnboardingStore } = requireStore();

    await useOnboardingStore.getState().decide();

    expect(useOnboardingStore.getState().decision).toBe('hide');
    expect(useOnboardingStore.getState().completed).toBe(true);
    expect(useOnboardingStore.getState().firstLaunchSession).toBe(false);
  });

  it.each(['na-pivo-settings', 'na-pivo-tally', 'na-pivo-pub-reminder-onboarding-seen-version'])(
    'grandfathers in an existing install on any long-lived key (%s)',
    async (key) => {
      await currentAsyncStorage().setItem(key, '{"anything":true}');
      const { useOnboardingStore } = requireStore();

      await useOnboardingStore.getState().decide();

      expect(useOnboardingStore.getState().decision).toBe('hide');
      expect(useOnboardingStore.getState().completed).toBe(true);
    },
  );

  it('hides when the onboarding was already completed on this device', async () => {
    await currentAsyncStorage().setItem(
      'na-pivo-onboarding',
      JSON.stringify({ state: { completed: true }, version: 0 }),
    );
    const { useOnboardingStore } = requireStore();

    await useOnboardingStore.getState().decide();

    expect(useOnboardingStore.getState().decision).toBe('hide');
    expect(useOnboardingStore.getState().completed).toBe(true);
  });

  it('is idempotent within a session (second call keeps the first decision)', async () => {
    const { useOnboardingStore } = requireStore();

    await useOnboardingStore.getState().decide();
    expect(useOnboardingStore.getState().decision).toBe('show');

    // A late release-baseline write (checkForUpdate) must not flip the decision.
    await currentAsyncStorage().setItem(
      'na-pivo-release',
      JSON.stringify({ state: { lastSeenVersion: '1.4.0' }, version: 0 }),
    );
    await useOnboardingStore.getState().decide();

    expect(useOnboardingStore.getState().decision).toBe('show');
  });

  it('re-shows after an interrupted first launch (pendingShow set, baseline since written)', async () => {
    // First launch decided 'show'; the user killed the app mid-pager AFTER the
    // release check wrote its baseline. The persisted pendingShow must win over
    // the existing-install key sniff.
    await currentAsyncStorage().setItem(
      'na-pivo-onboarding',
      JSON.stringify({ state: { completed: false, pendingShow: true }, version: 0 }),
    );
    await currentAsyncStorage().setItem(
      'na-pivo-release',
      JSON.stringify({ state: { lastSeenVersion: '1.4.0' }, version: 0 }),
    );
    const { useOnboardingStore } = requireStore();

    await useOnboardingStore.getState().decide();

    expect(useOnboardingStore.getState().decision).toBe('show');
    expect(useOnboardingStore.getState().firstLaunchSession).toBe(true);
  });

  it('complete() persists and flips the decision to hide', async () => {
    const { useOnboardingStore } = requireStore();

    await useOnboardingStore.getState().decide();
    useOnboardingStore.getState().complete();

    expect(useOnboardingStore.getState().decision).toBe('hide');
    expect(useOnboardingStore.getState().completed).toBe(true);
  });
});
