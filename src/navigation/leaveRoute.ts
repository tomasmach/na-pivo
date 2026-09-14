import type { Href, ImperativeRouter } from 'expo-router';

/**
 * Close a pushed screen without leaving a cold-start deep link on a blank root.
 * Expo Router always supplies `canGoBack`; the fallback for an absent method
 * only keeps lightweight test doubles backwards-compatible.
 */
export function leaveRoute(router: ImperativeRouter): void {
  if (typeof router.canGoBack !== 'function' || router.canGoBack()) {
    router.back();
    return;
  }

  router.replace('/(tabs)' as Href);
}
