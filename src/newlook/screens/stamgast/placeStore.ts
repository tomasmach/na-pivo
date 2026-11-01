import { useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import { create } from 'zustand';

import type { PermissionState } from '@/compass/permissions';
import { liveOutsideContext, type CountPlace } from '@/counter/countDrink';
import { useNearbyPub, type NearbyCandidate } from '@/counter/useNearbyPub';
import type { Pub } from '@/data/pubs';
import type { OutsidePlaceContext } from '@/drinks/drinkTypes';
import { useCounterHandoffStore } from '@/stores/counterHandoffStore';

/**
 * Where the new-look counter counts. The Štamgast tab owns GPS (useNearbyPub)
 * and publishes it here, so the "Kde sedíš?" sheet and the drink sheet read the
 * same place. Like the old counter, a pub is only ever an explicit pick, a
 * close auto-detect or the pub of the evening already running.
 */
interface PlaceState {
  outside: OutsidePlaceContext | null;
  picked: Pub | null;
  detected: Pub | null;
  candidates: NearbyCandidate[];
  loading: boolean;
  permission: PermissionState;
  requestPermission: () => Promise<void>;
  retry: () => void;
  setPicking: (active: boolean) => void;
  pickPub: (pub: Pub) => void;
  setOutside: (context: OutsidePlaceContext | null) => void;
}

export const useNvPlaceStore = create<PlaceState>((set) => ({
  outside: null,
  picked: null,
  detected: null,
  candidates: [],
  loading: false,
  permission: 'undetermined',
  requestPermission: async () => undefined,
  retry: () => undefined,
  setPicking: () => undefined,
  pickPub: (pub) => set({ picked: pub, outside: null }),
  setOutside: (context) => set({ outside: context }),
}));

function placeOf(state: Pick<PlaceState, 'outside' | 'picked' | 'detected'>): CountPlace | null {
  if (state.outside) return { kind: 'outside', context: state.outside };
  const pub = state.picked ?? state.detected;
  return pub ? { kind: 'pub', pub } : null;
}

export function useCountPlace(): CountPlace | null {
  const outside = useNvPlaceStore((s) => s.outside);
  const picked = useNvPlaceStore((s) => s.picked);
  const detected = useNvPlaceStore((s) => s.detected);
  return useMemo(() => placeOf({ outside, picked, detected }), [outside, picked, detected]);
}

export function currentCountPlace(): CountPlace | null {
  return placeOf(useNvPlaceStore.getState());
}

/** Run once in the Štamgast tab: GPS detection, pins and the tour handoff. */
export function useCountPlaceHost(): void {
  const nearby = useNearbyPub({ pauseWhenPinned: true });
  const { candidates, selected, selectPub, permissionState, requestPermission, loading, retry, setPicking } = nearby;
  const picked = useNvPlaceStore((s) => s.picked);

  useEffect(() => {
    useNvPlaceStore.setState({
      candidates,
      detected: selected,
      loading,
      permission: permissionState,
      requestPermission,
      setPicking,
      retry: () => {
        useNvPlaceStore.setState({ picked: null, outside: null });
        retry();
      },
    });
  }, [candidates, selected, loading, permissionState, requestPermission, retry, setPicking]);

  useEffect(() => {
    if (picked) selectPub(picked);
  }, [picked, selectPub]);

  useFocusEffect(
    useCallback(() => {
      const handoff = useCounterHandoffStore.getState().pub;
      if (handoff) {
        useCounterHandoffStore.getState().clear();
        useNvPlaceStore.getState().pickPub(handoff);
        return;
      }
      const outside = liveOutsideContext();
      if (outside) useNvPlaceStore.getState().setOutside(outside);
    }, []),
  );
}

/** A pub picked in the place sheet for the backfill form, never for the live counter. */
export const useBackfillPick = create<{ pub: Pub | null; set: (pub: Pub | null) => void }>((set) => ({
  pub: null,
  set: (pub) => set({ pub }),
}));
