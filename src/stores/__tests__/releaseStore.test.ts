import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The expo-constants mock reports version '1.1.3' — that is the "current"
// running build in every test here.
const CURRENT_VERSION = '1.1.3';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

/**
 * `beforeEach` calls `jest.resetModules()`, so each fresh `require('../releaseStore')`
 * binds to a NEW AsyncStorage mock instance. Read/seed via the same freshly
 * required instance the store persists into (mirrors settingsStore.test).
 */
function currentAsyncStorage() {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default ?? mod;
}

/** Seed the persisted baseline in the zustand-persist storage shape. */
async function seedLastSeenVersion(version: string): Promise<void> {
  await currentAsyncStorage().setItem(
    'na-pivo-release',
    JSON.stringify({ state: { lastSeenVersion: version }, version: 0 })
  );
}

function noteResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      version: CURRENT_VERSION,
      title: 'Co je nového',
      items: [{ icon: '🍺', text: 'Novinka' }],
    }),
  };
}

beforeEach(() => {
  jest.resetModules();
  (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {};
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
  } else {
    process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  }
  jest.clearAllMocks();
});

describe('useReleaseStore.checkForUpdate', () => {
  it('on a fresh install records the baseline silently and shows no popup', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { useReleaseStore } = require('../releaseStore');
    await useReleaseStore.getState().checkForUpdate();

    const state = useReleaseStore.getState();
    expect(state.lastSeenVersion).toBe(CURRENT_VERSION);
    expect(state.pendingNote).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when already on the last-seen version', async () => {
    await seedLastSeenVersion(CURRENT_VERSION);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { useReleaseStore } = require('../releaseStore');
    await useReleaseStore.getState().checkForUpdate();

    expect(useReleaseStore.getState().pendingNote).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('after an update, fetches the note and surfaces it WITHOUT advancing the baseline yet', async () => {
    await seedLastSeenVersion('1.0.0');
    global.fetch = jest.fn(noteResponse) as unknown as typeof fetch;

    const { useReleaseStore } = require('../releaseStore');
    await useReleaseStore.getState().checkForUpdate();

    const state = useReleaseStore.getState();
    expect(state.pendingNote).toEqual({
      version: CURRENT_VERSION,
      title: 'Co je nového',
      items: [{ icon: '🍺', text: 'Novinka' }],
    });
    // Not advanced until the user dismisses — a crash before dismissal re-shows it.
    expect(state.lastSeenVersion).toBe('1.0.0');
  });

  it('dismissNote clears the popup and advances the baseline to the note version', async () => {
    await seedLastSeenVersion('1.0.0');
    global.fetch = jest.fn(noteResponse) as unknown as typeof fetch;

    const { useReleaseStore } = require('../releaseStore');
    await useReleaseStore.getState().checkForUpdate();
    useReleaseStore.getState().dismissNote();

    const state = useReleaseStore.getState();
    expect(state.pendingNote).toBeNull();
    expect(state.lastSeenVersion).toBe(CURRENT_VERSION);
  });

  it('advances the baseline when the backend has no note (404), showing no popup', async () => {
    await seedLastSeenVersion('1.0.0');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'No release note for this version.' }),
    })) as unknown as typeof fetch;

    const { useReleaseStore } = require('../releaseStore');
    await useReleaseStore.getState().checkForUpdate();

    const state = useReleaseStore.getState();
    expect(state.pendingNote).toBeNull();
    expect(state.lastSeenVersion).toBe(CURRENT_VERSION);
  });

  it('leaves the baseline untouched on a network error so the check retries next launch', async () => {
    await seedLastSeenVersion('1.0.0');
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const { useReleaseStore } = require('../releaseStore');
    await useReleaseStore.getState().checkForUpdate();

    const state = useReleaseStore.getState();
    expect(state.pendingNote).toBeNull();
    expect(state.lastSeenVersion).toBe('1.0.0');
  });

  it('runs at most once per session (hasChecked guard)', async () => {
    await seedLastSeenVersion('1.0.0');
    const fetchSpy = jest.fn(noteResponse);
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { useReleaseStore } = require('../releaseStore');
    await useReleaseStore.getState().checkForUpdate();
    await useReleaseStore.getState().checkForUpdate();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
