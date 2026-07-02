/**
 * Compass handoff bus (Parta 3.0 §F2).
 *
 * "Ukaž na kompasu" on a friend card / plan / profile decodes the activity's
 * geohash-8 `cacheKey` to a COARSE cell centre (≈19 m, never raw GPS) and drops
 * it here; the compass screen consumes it to point the needle, then clears it.
 *
 * In-memory only — a one-shot handoff, nothing to persist.
 */

import { create } from 'zustand';

export interface FocusedPub {
  lat: number;
  lng: number;
  name: string;
  /** geohash-8 cell the coords were decoded from (coarse, privacy-safe). */
  cacheKey: string;
}

interface FocusedPubState {
  pub: FocusedPub | null;
  /** Point the compass at a friend's coarse pub cell. */
  setFocusedPub: (pub: FocusedPub) => void;
  /** Clear the handoff once the compass has consumed it. */
  clear: () => void;
}

export const useFocusedPubStore = create<FocusedPubState>((set) => ({
  pub: null,
  setFocusedPub: (pub) => set({ pub }),
  clear: () => set({ pub: null }),
}));
