/**
 * First-run onboarding store.
 *
 * Decides whether the one-time welcome pager (route `/onboarding`) should be
 * shown. Only `completed` persists; the rest is per-session.
 *
 * Fresh-install vs upgrade detection: there is no pre-existing install marker,
 * so decide() sniffs several long-lived AsyncStorage keys that any real install
 * accumulates (release baseline, settings, tally history, reminder-explainer
 * stamp). A fresh install always sees the pager. An existing install sees it
 * once only when it is signed out; signed-in users are grandfathered in. The
 * release baseline is written by releaseStore.checkForUpdate() even on a fresh
 * install, so app/_layout.tsx sequences decide() BEFORE that call; otherwise a
 * genuinely fresh install would race the baseline write and be misread as an
 * upgrade.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Long-lived keys whose presence marks an existing install (see above).
 *  `na-pivo-pub` covers legacy builds that predate the release baseline:
 *  anyone who ever revealed a pub has it, even with untouched settings. */
const EXISTING_INSTALL_KEYS = [
  'na-pivo-device-id',
  'na-pivo-release',
  'na-pivo-settings',
  'na-pivo-tally',
  'na-pivo-pub',
  'na-pivo-community',
  'na-pivo-pub-reminder-onboarding-seen-version',
];

interface OnboardingState {
  /** The user finished (or skipped) the onboarding, or was grandfathered in as
   *  a signed-in existing install. Persisted. */
  completed: boolean;
  /** An eligible install was told 'show' but hasn't completed yet. Persisted,
   *  so killing the app mid-pager re-shows it next launch — by then the release
   *  baseline exists and the key sniff below would misread a fresh install as
   *  an upgrade. */
  pendingShow: boolean;
  /** Launch decision: 'show' exactly once per eligible install. In-memory. */
  decision: 'pending' | 'show' | 'hide';
  /** True for the whole first-launch session (decision resolved to 'show').
   *  Other launch surfaces (e.g. the pub-reminder explainer) stay quiet for
   *  this entire session, not just while the pager route is open. In-memory. */
  firstLaunchSession: boolean;

  /** Resolve whether to show the onboarding this launch. Never throws. */
  decide: (getIsSignedIn: () => Promise<boolean | null>) => Promise<void>;
  /** Mark the onboarding as done (finished or skipped). */
  complete: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      completed: false,
      pendingShow: false,
      decision: 'pending',
      firstLaunchSession: false,

      decide: async (getIsSignedIn) => {
        if (get().decision !== 'pending') return;
        try {
          // Load the persisted flags before reading them (see releaseStore for
          // the same rehydrate-before-read reasoning).
          await useOnboardingStore.persist.rehydrate();
          if (get().decision !== 'pending') return;
          if (get().completed) {
            set({ decision: 'hide' });
            return;
          }
          // An interrupted first launch already earned the pager — re-show it.
          if (get().pendingShow) {
            set({ decision: 'show', firstLaunchSession: true });
            return;
          }
          const entries = await AsyncStorage.multiGet(EXISTING_INSTALL_KEYS);
          const existingInstall = entries.some(([, value]) => value != null);
          if (!existingInstall) {
            set({ decision: 'show', pendingShow: true, firstLaunchSession: true });
            return;
          }

          const isSignedIn = await getIsSignedIn();
          if (isSignedIn === true) {
            set({ completed: true, decision: 'hide' });
          } else if (isSignedIn === false) {
            set({ decision: 'show', pendingShow: true, firstLaunchSession: true });
          } else {
            // A protected Keychain can be unavailable during a locked iOS
            // background launch. Hide for this launch without persisting a
            // decision; the next normal launch can classify the user safely.
            set({ decision: 'hide' });
          }
        } catch {
          // Storage hiccup: skip the onboarding rather than risk re-showing it
          // to an existing user.
          set({ decision: 'hide' });
        }
      },

      complete: () => set({ completed: true, pendingShow: false, decision: 'hide' }),
    }),
    {
      name: 'na-pivo-onboarding',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ completed: state.completed, pendingShow: state.pendingShow }),
    },
  ),
);
