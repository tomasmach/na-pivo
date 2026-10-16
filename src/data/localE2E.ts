import { getBackendUrl } from './backendConfig';

/** Fake adapters are unreachable in release bundles or against a remote API. */
export function isLocalE2E(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_E2E === '1' &&
    /^http:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2):\d+$/.test(getBackendUrl());
}
