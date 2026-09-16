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

import { create } from 'zustand';

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
      set({ holder: id });
      return true;
    }
    return holder === id;
  },
  release: (id) => {
    if (get().holder === id) set({ holder: null });
  },
}));
