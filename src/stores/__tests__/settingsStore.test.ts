import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

/**
 * `beforeEach` calls `jest.resetModules()`, so each fresh load of `../settingsStore`
 * pulls in a NEW AsyncStorage mock instance with its own in-memory storage. The
 * top-level `import AsyncStorage` is bound to a different (stale) instance, so we
 * must read the SAME instance the freshly-required store persisted into.
 */
function currentAsyncStorage() {
  const mod = jest.requireMock('@react-native-async-storage/async-storage');
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
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    const state = useSettingsStore.getState();

    expect(state.mode).toBe('nearest');
    expect(state.homePoint).toBeNull();
    expect(state.navigationProvider).toBe('google');
    expect(state.maxDistanceKm).toBeNull();
    expect(state.priceCurrency).toBe('CZK');
    expect(state.hapticEnabled).toBe(true);
    expect(state.soundEnabled).toBe(false);
    expect(state.hideClosedPubs).toBe(true);
    expect(state.hidePubNames).toBe(false);
    expect(state.pubReminderEnabled).toBe(false);
    expect(state.waterNudgeEnabled).toBe(false);
    expect(typeof state.surpriseSeed).toBe('number');
  });

  it('persists the local-only water reminder opt-in', async () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();

    useSettingsStore.getState().setWaterNudgeEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.waterNudgeEnabled).toBe(true);
  });

  it('migrates the old implicit water nudge default to opt-in off', async () => {
    const storage = currentAsyncStorage();
    await storage.setItem('na-pivo-settings', JSON.stringify({
      state: { waterNudgeEnabled: true, hideClosedPubs: false },
      version: 0,
    }));

    const { useSettingsStore } = jest.requireActual('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();

    expect(useSettingsStore.getState().waterNudgeEnabled).toBe(false);
    expect(useSettingsStore.getState().hideClosedPubs).toBe(false);
  });

  it('stores only an explicitly set home point and navigation provider', async () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();

    useSettingsStore.getState().setHomePoint({ lat: 50.08, lng: 14.42 });
    useSettingsStore.getState().setNavigationProvider('mapy');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useSettingsStore.getState().homePoint).toEqual({ lat: 50.08, lng: 14.42 });
    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.homePoint).toEqual({ lat: 50.08, lng: 14.42 });
    expect(persisted.navigationProvider).toBe('mapy');
  });

  it('defaults hidePubNames to false (show pub names out of the box)', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    expect(useSettingsStore.getState().hidePubNames).toBe(false);
  });

  it('defaults hideClosedPubs to true (hide known-closed pubs out of the box)', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    expect(useSettingsStore.getState().hideClosedPubs).toBe(true);
  });

  it('defaults pub reminders to false (background location is explicit opt-in)', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    expect(useSettingsStore.getState().pubReminderEnabled).toBe(false);
  });

  it('setHideClosedPubs toggles the filter off and back on', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');

    useSettingsStore.getState().setHideClosedPubs(false);
    expect(useSettingsStore.getState().hideClosedPubs).toBe(false);

    useSettingsStore.getState().setHideClosedPubs(true);
    expect(useSettingsStore.getState().hideClosedPubs).toBe(true);
  });

  it('setHidePubNames toggles hidden names off and back on', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');

    useSettingsStore.getState().setHidePubNames(true);
    expect(useSettingsStore.getState().hidePubNames).toBe(true);

    useSettingsStore.getState().setHidePubNames(false);
    expect(useSettingsStore.getState().hidePubNames).toBe(false);
  });

  it('persists hideClosedPubs through the partialize/rehydrate cycle', async () => {
    // First store instance: flip the filter off and let it persist.
    {
      const { useSettingsStore } = jest.requireActual('../settingsStore');
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
    const { useSettingsStore } = jest.requireActual('../settingsStore');
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

  it('keeps hidePubNames in the partialized payload', async () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();

    useSettingsStore.getState().setHidePubNames(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.hidePubNames).toBe(true);
  });

  it('keeps pub reminders in the partialized payload', async () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();

    useSettingsStore.getState().setPubReminderEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.pubReminderEnabled).toBe(true);
  });

  it('setMode updates the mode', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    const { setMode } = useSettingsStore.getState();

    setMode('surprise');

    expect(useSettingsStore.getState().mode).toBe('surprise');
  });

  it('setMode can switch back to nearest', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    const { setMode } = useSettingsStore.getState();

    setMode('surprise');
    setMode('nearest');

    expect(useSettingsStore.getState().mode).toBe('nearest');
  });

  it('bumpSurpriseSeed increments the seed by 1', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    const initial = useSettingsStore.getState().surpriseSeed;

    useSettingsStore.getState().bumpSurpriseSeed();
    expect(useSettingsStore.getState().surpriseSeed).toBe(initial + 1);

    useSettingsStore.getState().bumpSurpriseSeed();
    expect(useSettingsStore.getState().surpriseSeed).toBe(initial + 2);
  });

  it('setMaxDistanceKm updates the distance', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    useSettingsStore.getState().setMaxDistanceKm(5);
    expect(useSettingsStore.getState().maxDistanceKm).toBe(5);
  });

  it('setMaxDistanceKm accepts null (unlimited)', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    useSettingsStore.getState().setMaxDistanceKm(5);
    useSettingsStore.getState().setMaxDistanceKm(null);
    expect(useSettingsStore.getState().maxDistanceKm).toBeNull();
  });

  it('setPriceCurrency switches between CZK and EUR', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');

    useSettingsStore.getState().setPriceCurrency('EUR');
    expect(useSettingsStore.getState().priceCurrency).toBe('EUR');

    useSettingsStore.getState().setPriceCurrency('CZK');
    expect(useSettingsStore.getState().priceCurrency).toBe('CZK');
  });

  it('keeps priceCurrency in the partialized payload', async () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    await (useSettingsStore.persist as any).rehydrate?.();

    useSettingsStore.getState().setPriceCurrency('EUR');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const raw = await currentAsyncStorage().getItem('na-pivo-settings');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string).state;
    expect(persisted.priceCurrency).toBe('EUR');
  });

  it('setHapticEnabled toggles haptic', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    useSettingsStore.getState().setHapticEnabled(false);
    expect(useSettingsStore.getState().hapticEnabled).toBe(false);
  });

  it('setSoundEnabled toggles sound', () => {
    const { useSettingsStore } = jest.requireActual('../settingsStore');
    useSettingsStore.getState().setSoundEnabled(true);
    expect(useSettingsStore.getState().soundEnabled).toBe(true);
  });
});
