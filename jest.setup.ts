import * as ReactNative from 'react-native';

import { shouldSuppressJestConsoleError } from './jestConsoleFilter';

Object.defineProperty(globalThis, '__DEV__', {
  configurable: true,
  value: true,
});

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  writable: true,
  value: true,
});

/**
 * `BackHandler` is missing from the React Native mock jest-expo installs, so any
 * component that closes itself on the Android back gesture — every sheet, via
 * `BottomSheetModal` — blew up in tests with "Cannot read properties of
 * undefined". Mocking it here rather than guarding in the component: the
 * component is right to assume the platform API exists, and a guard would hide
 * a real absence on a real device.
 */
const mutableReactNative = ReactNative as unknown as Record<string, unknown>;
if (!mutableReactNative.BackHandler) {
  mutableReactNative.BackHandler = {
    addEventListener: () => ({ remove: () => undefined }),
    removeEventListener: () => undefined,
    exitApp: () => undefined,
  };
}

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (shouldSuppressJestConsoleError(args)) return;
  originalConsoleError(...args);
};
