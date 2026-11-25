/**
 * Transient toast/snackbar state — a lightweight confirmation that survives
 * navigation (the trigger screen may unmount right after firing it, e.g. a
 * modal route calling router.back()). Not persisted; lives only in memory.
 *
 * `token` is bumped on every show() so the <Toast> re-animates even when the
 * same message is fired twice in a row.
 *
 * The leading visual defaults to the original 🍺 emoji so every existing caller
 * stays byte-identical. A caller may pass an optional leading IconGlyph element
 * instead (e.g. CompassIcon / SproutIcon in amber for Mapér XP events) — this is
 * the additive slot the "Zmapuj hospodu" toasts use to stay emoji-free.
 */

import type { ReactNode } from 'react';
import { create } from 'zustand';

/** Optional richer payload for show(). A bare string keeps the legacy call shape. */
export interface ToastOptions {
  /** Leading IconGlyph element. When omitted the toast renders the default 🍺. */
  icon?: ReactNode;
  /** Quiet second line under the message. */
  subtitle?: string;
  /** Makes the toast a door: tapping it runs this instead of only dismissing. */
  onPress?: () => void;
  durationMs?: number;
}

interface ToastState {
  message: string | null;
  token: number;
  /** Leading icon for the current toast, or null for the default beer emoji. */
  icon: ReactNode | null;
  subtitle: string | null;
  onPress: (() => void) | null;
  durationMs: number | null;
  /** The toast a finger is holding, so every toast host pauses its auto-dismiss together. */
  heldToken: number | null;
  show: (message: string, options?: ToastOptions) => void;
  hide: () => void;
  setHeldToken: (token: number | null) => void;
}

/** Runs `show` once no toast is on screen, so a waiting one never replaces another. */
export function whenToastIsFree(show: () => void): void {
  if (!useToastStore.getState().message) {
    show();
    return;
  }
  const stop = useToastStore.subscribe((state) => {
    if (state.message) return;
    stop();
    show();
  });
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  token: 0,
  icon: null,
  subtitle: null,
  onPress: null,
  durationMs: null,
  heldToken: null,
  show: (message, options) =>
    set((s) => ({
      message,
      icon: options?.icon ?? null,
      subtitle: options?.subtitle ?? null,
      onPress: options?.onPress ?? null,
      durationMs: options?.durationMs ?? null,
      token: s.token + 1,
    })),
  hide: () => set({ message: null, icon: null, subtitle: null, onPress: null, durationMs: null }),
  setHeldToken: (heldToken) => set({ heldToken }),
}));
