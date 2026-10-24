import type { useRouter } from 'expo-router';

import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { openDetail } from '@/layout/openDetail';
import type { PubPageParams } from '@/stores/bookStore';
import { pubPageRef, usePubPageStore } from '@/stores/pubPageStore';

type Router = ReturnType<typeof useRouter>;

/** The page params for a pub the caller already holds, parked in the hand-off store. */
export function pubPageParams(pub: Pub): PubPageParams {
  const key = geohash8(pub.lat, pub.lng);
  const ref = pubPageRef(pub);
  usePubPageStore.getState().remember(ref, pub);
  return { key, ref, name: pub.name, lat: String(pub.lat), lng: String(pub.lng) };
}

/** Open the pub page for a pub the caller already holds. */
export function openPubPage(router: Router, pub: Pub, options: { replace?: boolean } = {}): void {
  openDetail(router, { kind: 'pub', params: pubPageParams(pub) }, options);
}
