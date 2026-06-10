/**
 * Release ("what's new") store.
 *
 * Decides whether to show the "co je nového" popup on launch. The only persisted
 * value is `lastSeenVersion` — the app version the user has already been shown a
 * popup for. Everything else is per-session (in-memory).
 *
 * Launch flow (checkForUpdate):
 *  - Fresh install (lastSeenVersion === null): record the current version as the
 *    baseline silently — a brand-new user should not get a changelog.
 *  - Unchanged version: do nothing.
 *  - Version changed since last launch (i.e. the user updated): ask the backend
 *    for THIS version's note and surface it via `pendingNote`.
 *
 * IMPORTANT: zustand's persist middleware rehydrates from AsyncStorage
 * asynchronously. checkForUpdate() therefore awaits `persist.rehydrate()` before
 * reading `lastSeenVersion`; otherwise the first launch after an update could
 * compare against the in-memory default (null) instead of the stored value and
 * silently swallow the popup.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  fetchReleaseNote,
  getCurrentAppVersion,
  type ReleaseNote,
} from '@/data/releaseNotesClient';

interface ReleaseState {
  /** Last app version the user has already seen the popup for. null = fresh
   *  install (or upgrade from before this feature existed). Persisted. */
  lastSeenVersion: string | null;
  /** The note to show right now, or null when nothing is pending. In-memory. */
  pendingNote: ReleaseNote | null;
  /** Guards against re-running the launch check within one session. In-memory. */
  hasChecked: boolean;

  checkForUpdate: () => Promise<void>;
  dismissNote: () => void;
}

export const useReleaseStore = create<ReleaseState>()(
  persist(
    (set, get) => ({
      lastSeenVersion: null,
      pendingNote: null,
      hasChecked: false,

      checkForUpdate: async () => {
        if (get().hasChecked) return;

        // Load the persisted baseline BEFORE the first set(). A set() triggers a
        // persist write, so flipping hasChecked first would serialise the current
        // (still-default null) lastSeenVersion over the stored value, and the
        // rehydrate below would then read back that clobbered null — making every
        // post-update launch look like a fresh install. Rehydrate first, then
        // re-check the guard to collapse a concurrent double-call.
        await useReleaseStore.persist.rehydrate();
        if (get().hasChecked) return;
        set({ hasChecked: true });

        const current = getCurrentAppVersion();
        if (!current) return;

        const lastSeen = get().lastSeenVersion;

        // Fresh install (or pre-feature upgrade): set the baseline, no popup.
        if (lastSeen === null) {
          set({ lastSeenVersion: current });
          return;
        }

        // Already on (and already shown) this version.
        if (lastSeen === current) return;

        // The user updated since last launch — fetch this version's note.
        const result = await fetchReleaseNote(current);
        if (result.kind === 'note') {
          // lastSeenVersion is advanced only on dismissal, so a crash before the
          // user acknowledges still re-shows the note next launch.
          set({ pendingNote: result.note });
        } else if (result.kind === 'none') {
          // No note for this version — advance the baseline so we stop asking.
          set({ lastSeenVersion: current });
        }
        // 'error' (offline / timeout): leave the baseline so the check retries.
      },

      dismissNote: () => {
        const note = get().pendingNote;
        set({
          pendingNote: null,
          lastSeenVersion: note?.version ?? get().lastSeenVersion,
        });
      },
    }),
    {
      name: 'na-pivo-release',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the baseline persists; pendingNote / hasChecked are per-session.
      partialize: (state) => ({ lastSeenVersion: state.lastSeenVersion }),
    },
  ),
);
