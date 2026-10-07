import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { HomeTransitDeparture } from '@/transit/homeTransit';

interface HomeTransitState {
  /** Evening, pub and home the answer belongs to; any change makes it stale. */
  lookupKey: string | null;
  /** Null when no direct connection is left tonight or none was found. */
  departure: HomeTransitDeparture | null;
  /** When the server last answered for `lookupKey`; 0 for no answer yet. */
  checkedAt: number;
  setResult: (lookupKey: string, departure: HomeTransitDeparture | null, checkedAt: number) => void;
  clear: () => void;
}

type PersistedHomeTransit = Pick<HomeTransitState, 'lookupKey' | 'departure' | 'checkedAt'>;

const EMPTY: PersistedHomeTransit = { lookupKey: null, departure: null, checkedAt: 0 };

function isDeparture(value: unknown): value is HomeTransitDeparture {
  if (!value || typeof value !== 'object') return false;
  const departure = value as Record<string, unknown>;
  return (
    typeof departure.departsAtMs === 'number' &&
    Number.isFinite(departure.departsAtMs) &&
    ['line', 'headsign', 'fromStopId', 'fromStopName', 'toStopId', 'toStopName'].every(
      (key) => typeof departure[key] === 'string',
    ) &&
    (departure.routeType === null || typeof departure.routeType === 'number')
  );
}

/** A malformed or partial copy on the phone starts empty instead of crashing. */
function restore(persisted: unknown): PersistedHomeTransit {
  const value = persisted as Partial<PersistedHomeTransit> | null;
  if (typeof value?.lookupKey !== 'string' || typeof value.checkedAt !== 'number') return EMPTY;
  if (value.departure !== null && !isDeparture(value.departure)) return EMPTY;
  return { lookupKey: value.lookupKey, departure: value.departure, checkedAt: value.checkedAt };
}

/**
 * Tonight's last direct connection home. Kept on the phone so an app restart
 * without signal keeps showing it; an offline evening simply goes without it.
 */
export const useHomeTransitStore = create<HomeTransitState>()(
  persist(
    (set) => ({
      ...EMPTY,
      setResult: (lookupKey, departure, checkedAt) => set({ lookupKey, departure, checkedAt }),
      clear: () => set(EMPTY),
    }),
    {
      name: 'na-pivo-home-transit',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state): PersistedHomeTransit => ({
        lookupKey: state.lookupKey,
        departure: state.departure,
        checkedAt: state.checkedAt,
      }),
      merge: (persisted, current) => ({ ...current, ...restore(persisted) }),
    },
  ),
);

export async function waitForHomeTransitHydration(): Promise<void> {
  const store = useHomeTransitStore.persist;
  if (store.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = store.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
    if (store.hasHydrated()) {
      unsubscribe();
      resolve();
    } else {
      void store.rehydrate();
    }
  });
}
