Object.defineProperty(globalThis, '__DEV__', {
  configurable: true,
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactNative = require('react-native');
if (!ReactNative.BackHandler) {
  ReactNative.BackHandler = {
    addEventListener: () => ({ remove: () => undefined }),
    removeEventListener: () => undefined,
    exitApp: () => undefined,
  };
}
