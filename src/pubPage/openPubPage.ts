import type { Href, useRouter } from 'expo-router';

import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { usePubPageStore } from '@/stores/pubPageStore';

type Router = ReturnType<typeof useRouter>;

/** Open the pub page for a pub the caller already holds. */
export function openPubPage(router: Router, pub: Pub): void {
  const key = geohash8(pub.lat, pub.lng);
  usePubPageStore.getState().remember(key, pub);
  router.push({
    pathname: '/pub',
    params: { key, name: pub.name, lat: String(pub.lat), lng: String(pub.lng) },
  } as unknown as Href);
}
