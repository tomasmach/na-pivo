/**
 * Minimal react-native mock for jest tests.
 * Only mocks the subset actually used in this project's tests.
 */

export const Platform = {
  OS: 'ios',
  select: (options: Record<string, unknown>) =>
    options['ios'] ?? options['default'] ?? undefined,
};

export const Linking = {
  openSettings: jest.fn().mockResolvedValue(undefined),
  openURL: jest.fn().mockResolvedValue(undefined),
  canOpenURL: jest.fn().mockResolvedValue(true),
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const AppState = {
  currentState: 'active',
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

export const NativeModules = {};
export const NativeEventEmitter = jest.fn(() => ({
  addListener: jest.fn(),
  removeAllListeners: jest.fn(),
}));
