import { create } from 'zustand';

import {
  ensureAccount,
  fetchAccountPreferences,
  type AccountSession,
} from '@/data/account';
import { useSettingsStore } from '@/stores/settingsStore';

export type AccountStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AccountState {
  session: AccountSession | null;
  status: AccountStatus;
  /**
   * Ensure an anonymous account exists. Never throws. A call made while one is
   * already in flight is ignored (concurrency guard); once settled it may be
   * called again to re-attempt (e.g. after the backend becomes reachable).
   */
  initAccount: () => Promise<void>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  session: null,
  status: 'idle',
  initAccount: async () => {
    if (get().status === 'loading') {
      return;
    }
    set({ status: 'loading' });
    try {
      const session = await ensureAccount();
      set({ session, status: session ? 'ready' : 'idle' });
      if (session) {
        const preferences = await fetchAccountPreferences();
        if (preferences) {
          useSettingsStore.getState().setHidePubNames(preferences.hidePubNames);
        }
      }
    } catch {
      // ensureAccount is already non-throwing; this is defence in depth.
      set({ status: 'error' });
    }
  },
}));
