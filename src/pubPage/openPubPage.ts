import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { pubPageRef, usePubPageStore } from '@/stores/pubPageStore';

/** The pub page's route params, in the order its openers pass them. */
export interface PubPageParams {
  key: string;
  ref?: string;
  name: string;
  lat: string;
  lng: string;
}

/** The page params for a pub the caller already holds, parked in the hand-off store. */
export function pubPageParams(pub: Pub): PubPageParams {
  const key = geohash8(pub.lat, pub.lng);
  const ref = pubPageRef(pub);
  usePubPageStore.getState().remember(ref, pub);
  return { key, ref, name: pub.name, lat: String(pub.lat), lng: String(pub.lng) };
}

