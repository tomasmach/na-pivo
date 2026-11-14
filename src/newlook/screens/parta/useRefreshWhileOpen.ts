import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';

import { usePartaStore } from './partaStore';

export const PARTA_REFRESH_MS = 35_000;

export function useRefreshWhileOpen(): void {
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let lastLoadAt = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = () => {
      lastLoadAt = Date.now();
      void usePartaStore.getState().load();
    };
    const start = () => {
      timer ??= setInterval(load, PARTA_REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return stop();
      if (Date.now() - lastLoadAt >= PARTA_REFRESH_MS) load();
      start();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [focused]);
}
