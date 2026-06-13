/**
 * Transient toast/snackbar state — a lightweight confirmation that survives
 * navigation (the trigger screen may unmount right after firing it, e.g. a
 * fullScreenModal calling router.back()). Not persisted; lives only in memory.
 *
 * `token` is bumped on every show() so the <Toast> re-animates even when the
 * same message is fired twice in a row.
 */

import { create } from 'zustand';

interface ToastState {
  message: string | null;
  token: number;
  show: (message: string) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  token: 0,
  show: (message) => set((s) => ({ message, token: s.token + 1 })),
  hide: () => set({ message: null }),
}));
