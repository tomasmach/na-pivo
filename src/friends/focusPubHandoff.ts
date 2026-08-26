/**
 * "Ukaž na kompasu" handoff (Parta 3.0 §F2).
 *
 * A friend card / plan / profile only ever holds a geohash-8 `cacheKey` for the
 * pub (privacy: ~19 m coarse, never raw GPS). This decodes that key to the cell
 * centre and drops it into `focusedPubStore`; the caller then `router.push('/')`
 * so the Kompas tab points its needle at the friend's coarse pub.
 *
 * Returns false (and sets nothing) when there is no usable cacheKey, so the
 * caller can skip the navigation.
 */

import { decodeGeohash8 } from '@/data/geohash';
import { t } from '@/i18n';
import { useFocusedPubStore } from '@/stores/focusedPubStore';

export function focusPubFromActivity(activity: {
  cacheKey: string;
  name: string;
}): boolean {
  const key = activity.cacheKey?.trim();
  if (!key) return false;
  const { lat, lng } = decodeGeohash8(key);
  useFocusedPubStore.getState().setFocusedPub({
    lat,
    lng,
    name: activity.name?.trim() || t.friends.pubFallback,
    cacheKey: key,
  });
  return true;
}
