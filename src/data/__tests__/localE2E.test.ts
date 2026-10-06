import { getBackendUrl } from '../backendConfig';
import { isLocalE2E } from '../localE2E';

jest.mock('../backendConfig', () => ({ getBackendUrl: jest.fn() }));
const backendUrl = jest.mocked(getBackendUrl);
const originalFlag = process.env.EXPO_PUBLIC_E2E;
const originalDev = __DEV__;

afterEach(() => {
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: originalDev });
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_E2E;
  else process.env.EXPO_PUBLIC_E2E = originalFlag;
});

it.each([
  [false, '1', 'http://127.0.0.1:18121', false],
  [true, '', 'http://127.0.0.1:18121', false],
  [true, '1', 'https://api.example.test', false],
  [true, '1', 'http://127.0.0.1.example.test:18121', false],
  [true, '1', 'http://127.0.0.1:18121', true],
])('limits fake adapters to an explicit local development run (%s, %s, %s)', (dev, flag, url, enabled) => {
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: dev });
  process.env.EXPO_PUBLIC_E2E = flag;
  backendUrl.mockReturnValue(url);
  expect(isLocalE2E()).toBe(enabled);
});
