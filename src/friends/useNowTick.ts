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

import { intlLocale, t } from '@/i18n';

const TICK_MS = 60_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

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

// --- Formatting helpers -------------------------------------------------------

function parseMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * "před 20 min" — how long ago `iso` was, relative to `now`.
 * Returns "" for an unparseable timestamp. Falls back to a short local date
 * for anything older than a week.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const ms = parseMs(iso);
  if (ms === null) return '';

  const diff = now - ms;
  if (diff < MINUTE_MS) return t.relativeTime.now;
  if (diff < HOUR_MS) return t.relativeTime.minutesAgo(Math.floor(diff / MINUTE_MS));
  if (diff < DAY_MS) return t.relativeTime.hoursAgo(Math.floor(diff / HOUR_MS));
  if (diff < 7 * DAY_MS) return t.relativeTime.daysAgo(Math.floor(diff / DAY_MS));

  return new Date(ms).toLocaleDateString(intlLocale, { day: 'numeric', month: 'numeric' });
}

/**
 * "ještě 2 h 40 min" — time left until `iso`, relative to `now`.
 * Returns "" for an unparseable or already-passed timestamp (the caller hides
 * an expired card on its own).
 */
export function formatExpiry(iso: string, now: number = Date.now()): string {
  const ms = parseMs(iso);
  if (ms === null) return '';

  const remaining = ms - now;
  if (remaining <= 0) return '';
  if (remaining < MINUTE_MS) return t.relativeTime.soon;

  const hours = Math.floor(remaining / HOUR_MS);
  const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);

  if (hours > 0) {
    return minutes > 0
      ? t.relativeTime.hoursMinutesLeft(hours, minutes)
      : t.relativeTime.hoursLeft(hours);
  }
  return t.relativeTime.minutesLeft(minutes);
}
