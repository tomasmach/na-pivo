import { create } from 'zustand';
import type { useRouter } from 'expo-router';

import { updateAccountPreferences } from '@/data/account';
import type { CommunityBeer, WeeklyHours } from '@/data/communityHours';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import type { AmenityKey } from '@/data/amenities';
import { EMPTY_PUB_SEARCH_FILTERS, MAX_AMENITY_FILTERS, normalizePubSearchFilters, type PubSearchFilters } from '@/data/pubSearchFilters';
import type { VisitedPubSummary } from '@/map/mapModel';
import { pubPageParams } from '@/pubPage/openPubPage';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import { useSettingsStore } from '@/stores/settingsStore';

export type MapView = 'okoli' | 'stopy' | 'parta';
export type PinMode = 'price' | 'count';

/**
 * What the Kompas tab, its sheets and the search share while the app runs:
 * the filters, the map layer and a pub the user picked themselves. Nothing here
 * is persisted, the same as the old compass screen's own filter state.
 */
type KompasState = {
  filters: PubSearchFilters;
  mapView: MapView;
  pinMode: PinMode;
  onlyDrunk: boolean;
  /** A pub picked on the map, in search or on its page; it wins over the compass's own pick. */
  picked: Pub | null;
  /** Opening hours being edited in "Doplnit info", shared with the one-day sheet. */
  hoursDraft: { key: string; hours: WeeklyHours } | null;
  /** A menu photo read for "Doplnit info": the beers it already lists and where the confirmed ones go. */
  menuScan: { known: CommunityBeer[]; add: (beers: CommunityBeer[]) => void } | null;
  /** Pubs visited in one city, handed from the "Moje stopy" card to its list. */
  cityPubs: { name: string; pubs: VisitedPubSummary[] } | null;
  /** A point aimed on the pin map, picked up by "Přidat hospodu". */
  pin: { lat: number; lng: number } | null;
  set: (patch: Partial<Omit<KompasState, 'set' | 'setFilters' | 'clearFilters' | 'pick'>>) => void;
  setFilters: (patch: Partial<PubSearchFilters>) => void;
  clearFilters: () => void;
  pick: (pub: Pub | null) => void;
};

export const useKompasState = create<KompasState>((set, get) => ({
  filters: EMPTY_PUB_SEARCH_FILTERS,
  mapView: 'okoli',
  pinMode: 'price',
  onlyDrunk: false,
  picked: null,
  hoursDraft: null,
  menuScan: null,
  cityPubs: null,
  pin: null,
  set: (patch) => set(patch),
  setFilters: (patch) => set({ filters: normalizePubSearchFilters({ ...get().filters, ...patch }) }),
  clearFilters: () => {
    set({ filters: EMPTY_PUB_SEARCH_FILTERS, onlyDrunk: false });
    setOpenOnly(false);
  },
  pick: (pub) => {
    // A friend's handoff and a picked pub are both "not the compass's own pick";
    // the newest choice wins.
    if (pub) useFocusedPubStore.getState().clear();
    set({ picked: pub });
  },
}));

/** Returns false and changes nothing when another amenity would go over the server's limit. */
export function toggleAmenityFilter(key: AmenityKey): boolean {
  const { filters, setFilters } = useKompasState.getState();
  if (filters.amenityKeys.includes(key)) {
    setFilters({ amenityKeys: filters.amenityKeys.filter((k) => k !== key) });
    return true;
  }
  if (filters.amenityKeys.length >= MAX_AMENITY_FILTERS) return false;
  setFilters({ amenityKeys: [...filters.amenityKeys, key] });
  return true;
}

/** "Překvap mě" is the old compass's surprise mode, synced to the account like before. */
export function setSurprise(on: boolean): void {
  const mode = on ? 'surprise' : 'nearest';
  useSettingsStore.getState().setMode(mode);
  void updateAccountPreferences({ mode });
}

/** "Jen otevřené" is the settings' hide-closed switch, synced to the account like before. */
export function setOpenOnly(on: boolean): void {
  if (useSettingsStore.getState().hideClosedPubs === on) return;
  useSettingsStore.getState().setHideClosedPubs(on);
  void updateAccountPreferences({ hideClosedPubs: on });
}

type Router = ReturnType<typeof useRouter>;

/** Route params of the new-look pub page. `id` is the pub's geohash-8 cell. */
export function nvPubParams(pub: Pub): { id: string; ref: string; name: string; lat: string; lng: string } {
  const { key, ref, name, lat, lng } = pubPageParams(pub);
  return { id: key, ref: ref ?? '', name, lat, lng };
}

/** `via: 'card'` makes the page rise from the bottom card it was pulled out of. */
export function openNvPub(router: Router, pub: Pub, via?: 'card'): void {
  router.push({ pathname: '/nv/hospoda/[id]', params: via ? { ...nvPubParams(pub), via } : nvPubParams(pub) });
}

/** Point the compass at a pub and switch to the Kompas tab. */
export function showOnKompas(router: Router, pub: Pub, view: MapView = 'okoli'): void {
  useKompasState.getState().pick(pub);
  useKompasState.getState().set({ mapView: view });
  router.dismissTo('/nv/kompas');
}

export function pubKey(pub: { lat: number; lng: number }): string {
  return geohash8(pub.lat, pub.lng);
}
