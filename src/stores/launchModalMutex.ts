/**
 * Launch-modal mutex — at most ONE launch popup presents at a time.
 *
 * Two sibling RN Modals visible at once wedge the whole UI on iOS (the second
 * never presents but blocks touches until the app restarts). WhatsNewModal is
 * the head of the chain (everything gates on releaseStore.checkSettled +
 * pendingNote); the popups behind it (pub-reminder onboarding, contest
 * results) race each other, so they claim this mutex before presenting and
 * release it on dismiss. A waiter re-claims automatically when the holder
 * releases (components subscribe to `holder`).
 */

import { useEffect, useId } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';

/** Native iOS presentation remains busy for a short beat after visible=false. */
export const MODAL_DISMISS_MS = 260;
const MODAL_DISMISS_BACKSTOP_MS = 1_200;

interface Dismissal {
  startedAt: number;
  nativeDismissed: boolean;
  waitForNativeDismiss: boolean;
  minTimer: ReturnType<typeof setTimeout>;
  backstopTimer: ReturnType<typeof setTimeout> | null;
}

const dismissals = new Map<string, Dismissal>();
const earlyNativeDismissals = new Set<string>();

function clearDismissal(id: string): void {
  const dismissal = dismissals.get(id);
  if (!dismissal) return;
  clearTimeout(dismissal.minTimer);
  if (dismissal.backstopTimer) clearTimeout(dismissal.backstopTimer);
  dismissals.delete(id);
  earlyNativeDismissals.delete(id);
}

function releaseWhenSafe(id: string): void {
  const dismissal = dismissals.get(id);
  if (!dismissal) return;
  const minimumElapsed = Date.now() - dismissal.startedAt >= MODAL_DISMISS_MS;
  if (!minimumElapsed || (dismissal.waitForNativeDismiss && !dismissal.nativeDismissed)) return;
  clearDismissal(id);
  useLaunchModalMutex.getState().release(id);
}

function beginDismiss(id: string, waitForNativeDismiss: boolean): void {
  if (useLaunchModalMutex.getState().holder !== id || dismissals.has(id)) return;
  const alreadyDismissed = earlyNativeDismissals.delete(id);
  const dismissal: Dismissal = {
    startedAt: Date.now(),
    nativeDismissed: !waitForNativeDismiss || alreadyDismissed,
    waitForNativeDismiss,
    minTimer: setTimeout(() => releaseWhenSafe(id), MODAL_DISMISS_MS),
    backstopTimer: null,
  };
  if (waitForNativeDismiss) {
    dismissal.backstopTimer = setTimeout(() => {
      const current = dismissals.get(id);
      if (!current) return;
      current.nativeDismissed = true;
      releaseWhenSafe(id);
    }, MODAL_DISMISS_BACKSTOP_MS);
  }
  dismissals.set(id, dismissal);
}

function completeNativeDismiss(id: string): void {
  const dismissal = dismissals.get(id);
  if (!dismissal) {
    // A Reduce Motion dismissal can beat React's passive effect that creates
    // the record. Remember that native event instead of falling back to 1.2 s.
    if (useLaunchModalMutex.getState().holder === id) earlyNativeDismissals.add(id);
    return;
  }
  dismissal.nativeDismissed = true;
  releaseWhenSafe(id);
}

interface LaunchModalMutexState {
  holder: string | null;
  /** Acquire the slot. True when acquired (or already held by `id`). */
  claim: (id: string) => boolean;
  release: (id: string) => void;
}

export const useLaunchModalMutex = create<LaunchModalMutexState>()((set, get) => ({
  holder: null,
  claim: (id) => {
    const holder = get().holder;
    if (holder === null) {
      clearDismissal(id);
      earlyNativeDismissals.delete(id);
      set({ holder: id });
      return true;
    }
    if (holder === id) clearDismissal(id);
    return holder === id;
  },
  release: (id) => {
    clearDismissal(id);
    earlyNativeDismissals.delete(id);
    if (get().holder === id) set({ holder: null });
  },
}));

/**
 * Coordinates every RN Modal, not only launch nudges. A requested sibling waits
 * until the current native presentation has dismissed and the 260 ms safety
 * window has elapsed. Reduce Motion never shortens this lifecycle boundary.
 */
export function useModalPresentation(
  requested: boolean,
  explicitId?: string,
): { visible: boolean; onDismiss: () => void; id: string } {
  const reactId = useId();
  const id = explicitId ?? `modal-${reactId}`;
  const holder = useLaunchModalMutex((state) => state.holder);
  const waitForNativeDismiss = Platform.OS === 'ios';

  useEffect(() => {
    if (requested) {
      useLaunchModalMutex.getState().claim(id);
    } else if (holder === id) {
      beginDismiss(id, waitForNativeDismiss);
    }
  }, [holder, id, requested, waitForNativeDismiss]);

  useEffect(
    () => () => {
      if (useLaunchModalMutex.getState().holder === id) {
        beginDismiss(id, waitForNativeDismiss);
      }
    },
    [id, waitForNativeDismiss],
  );

  return {
    visible: requested && holder === id,
    onDismiss: () => completeNativeDismiss(id),
    id,
  };
}
