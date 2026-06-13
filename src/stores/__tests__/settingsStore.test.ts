import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

/**
 * `beforeEach` calls `jest.resetModules()`, so each fresh `require('../settingsStore')`
 * pulls in a NEW AsyncStorage mock instance with its own in-memory storage. The
 * top-level `import AsyncStorage` is bound to a different (stale) instance, so we
 * must read the SAME instance the freshly-required store persisted into.
 */
function currentAsyncStorage() {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default ?? mod;
}

// Reset zustand store between tests by re-importing fresh each time
// We use the module registry to get a clean slate
beforeEach(() => {
  jest.resetModules();
  // Clear the in-memory mock storage so persisted state doesn't bleed between tests
  (AsyncStorage as any).__INTERNAL_MOCK_STORAGE__ = {};
});

describe('useSettingsStore', () => {
  it('has correct default state', () => {
    const { useSettingsStore } = require('../settingsStore');
    const state = useSettingsStore.getState();

    expect(state.mode).toBe('nearest');
    expect(state.maxDistanceKm).toBeNull();
    expect(state.priceCurrency).toBe('CZK');
    expect(state.hapticEnabled).toBe(true);
    expect(state.soundEnabled).toBe(false);
    expect(state.hideClosedPubs).toBe(true);
    expect(typeof state.surpriseSeed).toBe('number');
  });

  it('defaults hideClosedPubs to true (hide known-closed pubs out of the box)', () => {
    const { useSettingsStore } = require('../settingsStore');
    expect(useSettingsStore.getState().hideClosedPubs).toBe(true);
  });

  it('setHideClosedPubs toggles the filter off and back on', () => {
    const { useSettingsStore } = require('../settingsStore');

    useSettingsStore.getState().setHideClosedPubs(false);
    expect(useSettingsStore.getState().hideClosedPubs).toBe(false);

    useSettingsStore.getState().setHideClosedPubs(true);
    expect(useSettingsStore.getState().hideClosedPubs).toBe(true);
  });

  it('persists hideClosedPubs through the partialize/rehydrate cycle', async () => {
    // First store instance: flip the filter off and let it persist.
    {
      const { useSettingsStore } = require('../settingsStore');
      await (useSettingsStore.persist as any).rehydrate?.();
      useSettingsStore.getState().setHideClosedPubs(false);
      // Let zustand's async setItem write flush through the storage mock.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Confirm the value actually landed in the persisted (partialized) payload.
    // Read via the awaitable getItem rather than poking at mock internals, and
    // from the same mock instance the store wrote to.
    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).state.hideClosedPubs).toBe(false);
  });

  it('keeps hideClosedPubs in the partialized payload', async () => {
    const { useSettingsStore } = require('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();
    // Mutate any field so a write is triggered, then inspect the stored shape.
    useSettingsStore.getState().setHideClosedPubs(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted).toHaveProperty('hideClosedPubs');
    expect(persisted.hideClosedPubs).toBe(true);
  });

  it('setMode updates the mode', () => {
    const { useSettingsStore } = require('../settingsStore');
    const { setMode } = useSettingsStore.getState();

    setMode('surprise');

    expect(useSettingsStore.getState().mode).toBe('surprise');
  });

  it('setMode can switch back to nearest', () => {
    const { useSettingsStore } = require('../settingsStore');
    const { setMode } = useSettingsStore.getState();

    setMode('surprise');
    setMode('nearest');

    expect(useSettingsStore.getState().mode).toBe('nearest');
  });

  it('bumpSurpriseSeed increments the seed by 1', () => {
    const { useSettingsStore } = require('../settingsStore');
    const initial = useSettingsStore.getState().surpriseSeed;

    useSettingsStore.getState().bumpSurpriseSeed();
    expect(useSettingsStore.getState().surpriseSeed).toBe(initial + 1);

    useSettingsStore.getState().bumpSurpriseSeed();
    expect(useSettingsStore.getState().surpriseSeed).toBe(initial + 2);
  });

  it('setMaxDistanceKm updates the distance', () => {
    const { useSettingsStore } = require('../settingsStore');
    useSettingsStore.getState().setMaxDistanceKm(5);
    expect(useSettingsStore.getState().maxDistanceKm).toBe(5);
  });

  it('setMaxDistanceKm accepts null (unlimited)', () => {
    const { useSettingsStore } = require('../settingsStore');
    useSettingsStore.getState().setMaxDistanceKm(5);
    useSettingsStore.getState().setMaxDistanceKm(null);
    expect(useSettingsStore.getState().maxDistanceKm).toBeNull();
  });

  it('setPriceCurrency switches between CZK and EUR', () => {
    const { useSettingsStore } = require('../settingsStore');

    useSettingsStore.getState().setPriceCurrency('EUR');
    expect(useSettingsStore.getState().priceCurrency).toBe('EUR');

    useSettingsStore.getState().setPriceCurrency('CZK');
    expect(useSettingsStore.getState().priceCurrency).toBe('CZK');
  });

  it('keeps priceCurrency in the partialized payload', async () => {
    const { useSettingsStore } = require('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();

    useSettingsStore.getState().setPriceCurrency('EUR');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.priceCurrency).toBe('EUR');
  });

  it('setHapticEnabled toggles haptic', () => {
    const { useSettingsStore } = require('../settingsStore');
    useSettingsStore.getState().setHapticEnabled(false);
    expect(useSettingsStore.getState().hapticEnabled).toBe(false);
  });

  it('setSoundEnabled toggles sound', () => {
    const { useSettingsStore } = require('../settingsStore');
    useSettingsStore.getState().setSoundEnabled(true);
    expect(useSettingsStore.getState().soundEnabled).toBe(true);
  });
});
