/**
 * Shared 1-minute ticker for relative/expiry time labels.
 *
 * A single module-level interval drives every consumer (no per-card timers).
 * The interval pauses while the app is backgrounded and refreshes immediately
 * on foreground so stale "před N min" / "ještě N h" labels jump to the truth.
 *
 * `useNowTick()` returns the current epoch ms and re-renders subscribers once a
 * minute. `formatRelative` / `formatExpiry` are pure helpers; pass the ticked
 * value as `now` so they recompute on each tick (default `Date.now()`).
 */

import { useSyncExternalStore } from 'react';
import { AppState, AppStateStatus } from 'react-native';

const TICK_MS = 60_000;

// --- Singleton ticker store ---------------------------------------------------

let currentNow = Date.now();
const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function setNow(value: number): void {
  if (value === currentNow) return;
  currentNow = value;
  emit();
}

function startInterval(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(() => setNow(Date.now()), TICK_MS);
}

function stopInterval(): void {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
}

function handleAppState(state: AppStateStatus): void {
  if (state === 'active') {
    setNow(Date.now()); // labels may be stale after a blur — jump to now first
    startInterval();
  } else {
    stopInterval();
  }
}

function subscribe(listener: () => void): () => void {
  const wasIdle = listeners.size === 0;
  listeners.add(listener);

  if (wasIdle) {
    // First subscriber: align the clock and wire the shared interval + AppState.
    currentNow = Date.now();
    appStateSub = AppState.addEventListener('change', handleAppState);
    if (AppState.currentState === 'active') startInterval();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopInterval();
      appStateSub?.remove();
      appStateSub = null;
    }
  };
}

function getSnapshot(): number {
  return currentNow;
}

/**
 * Subscribe to the shared 1-minute ticker. Returns the current epoch ms and
 * re-renders the calling component each tick.
 */
export function useNowTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
