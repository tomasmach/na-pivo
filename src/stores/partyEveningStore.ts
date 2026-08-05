/**
 * The real shared evening: one per phone, or none.
 *
 * The hub has been running on a mock. This is the store the real thing hangs
 * off — who is at the table, what the code is, and whether we are still in it.
 * It holds exactly what the server says and nothing derived, so there is one
 * answer to "am I in an evening" and every screen reads the same one.
 *
 * Deliberately NOT persisted. The server already knows which evening this
 * account is in and answers it in one request; a cached copy would only be a
 * second, staler truth — and the failure it creates (the app insisting you are
 * at a table you left last night) is worse than a launch that asks.
 *
 * `error` is the last thing that went wrong, in Czech, ready to show. The store
 * never throws and never blocks: the client is best-effort, so a pub with no
 * signal leaves the evening exactly as it was.
 */

import { create } from 'zustand';

import { generateUuidV4 } from '@/data/account';
import {
  createPartyEvening,
  endPartyEvening,
  fetchCurrentPartyEvening,
  generateJoinCode,
  joinPartyEvening,
  leavePartyEvening,
  type PartyError,
  type PartyEvening,
} from '@/data/partyClient';

interface PartyEveningState {
  evening: PartyEvening | null;
  /** True while a call is in flight — the UI disables rather than double-taps. */
  busy: boolean;
  /** True once the launch check has answered, so the UI can tell "no" from "not yet". */
  loaded: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  start: (pubName: string, pubCity?: string) => Promise<PartyEvening | null>;
  join: (code: string) => Promise<PartyEvening | null>;
  leave: () => Promise<boolean>;
  end: () => Promise<boolean>;
  clearError: () => void;
}

function failed(set: (patch: Partial<PartyEveningState>) => void, error: PartyError): null {
  set({ busy: false, error: error.detail });
  return null;
}

export const usePartyEveningStore = create<PartyEveningState>()((set, get) => ({
  evening: null,
  busy: false,
  loaded: false,
  error: null,

  refresh: async () => {
    const result = await fetchCurrentPartyEvening();
    if (!result.ok) {
      // A failed refresh is not "you are not in an evening". Keep what we have
      // and say nothing — walking into a cellar must not close the table.
      set({ loaded: true });
      return;
    }
    set({ evening: result.evening, loaded: true, error: null });
  },

  start: async (pubName, pubCity) => {
    if (get().busy) return null;
    set({ busy: true, error: null });
    const result = await createPartyEvening({
      // The id is the retry ticket: a second attempt after a lost response
      // returns the evening already created rather than starting another.
      clientId: generateUuidV4(),
      joinCode: generateJoinCode(),
      pubName,
      pubCity,
    });
    if (!result.ok) return failed(set, result);
    set({ evening: result.evening, busy: false, loaded: true });
    return result.evening;
  },

  join: async (code) => {
    if (get().busy) return null;
    set({ busy: true, error: null });
    const result = await joinPartyEvening(code);
    if (!result.ok) return failed(set, result);
    set({ evening: result.evening, busy: false, loaded: true });
    return result.evening;
  },

  leave: async () => {
    const evening = get().evening;
    if (!evening || get().busy) return false;
    set({ busy: true, error: null });
    const result = await leavePartyEvening(evening.joinCode);
    if (!result.ok) {
      failed(set, result);
      return false;
    }
    // Leaving is not ending: the table plays on, this phone is just out of it.
    set({ evening: null, busy: false });
    return true;
  },

  end: async () => {
    const evening = get().evening;
    if (!evening || get().busy) return false;
    set({ busy: true, error: null });
    const result = await endPartyEvening(evening.joinCode);
    if (!result.ok) {
      failed(set, result);
      return false;
    }
    set({ evening: null, busy: false });
    return true;
  },

  clearError: () => set({ error: null }),
}));
