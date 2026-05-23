import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

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
    expect(state.hapticEnabled).toBe(true);
    expect(state.soundEnabled).toBe(false);
    expect(typeof state.surpriseSeed).toBe('number');
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
