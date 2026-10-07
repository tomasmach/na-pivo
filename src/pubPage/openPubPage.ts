import type { Href, useRouter } from 'expo-router';

import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { pubPageRef, usePubPageStore } from '@/stores/pubPageStore';

type Router = ReturnType<typeof useRouter>;

/** Open the pub page for a pub the caller already holds. */
export function openPubPage(router: Router, pub: Pub, options: { replace?: boolean } = {}): void {
  const key = geohash8(pub.lat, pub.lng);
  const ref = pubPageRef(pub);
  usePubPageStore.getState().remember(ref, pub);
  const href = {
    pathname: '/pub',
    params: { key, ref, name: pub.name, lat: String(pub.lat), lng: String(pub.lng) },
  } as unknown as Href;
  if (options.replace) router.replace(href);
  else router.push(href);
}
