import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';

import { usePartaStore } from './partaStore';

export const PARTA_REFRESH_MS = 35_000;

export function useRefreshWhileOpen(): void {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let lastRefreshAt = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      lastRefreshAt = Date.now();
      void usePartaStore.getState().refresh();
    };
    const start = () => {
      timer ??= setInterval(refresh, PARTA_REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return stop();
      if (Date.now() - lastRefreshAt >= PARTA_REFRESH_MS) refresh();
      start();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [focused]);
}
