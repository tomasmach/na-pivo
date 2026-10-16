/**
 * Rename a pub for everyone: fix the local catalog entry when the pub has a
 * provider id, then queue the public name correction. Shared by the mapping
 * sheet and the pub page so both follow the same path.
 */

import type { PubInfoContext } from '@/components/amenities/pubInfoContext';
import { buildPubNameCorrectionEntry } from '@/data/pubNameCorrectionsClient';
import { enqueuePubNameCorrection } from '@/data/pubNameCorrectionsQueue';
import { clearPubsSnapshot, renameLocalPub, type Pub } from '@/data/pubs';
import { usePubStore } from '@/stores/pubStore';

/** Resolves to true when the correction reached the server, false when queued. */
export function submitPubRename(
  info: PubInfoContext,
  currentName: string,
  nextName: string,
): Promise<boolean> {
  // A pub with a known external id renames locally too (in-memory index +
  // snapshot clear, so the new name survives a reload); otherwise only the
  // public correction queues. The catalog bump makes index readers (compass
  // selection, beer map) re-read the renamed entry.
  if (info.externalId) {
    renameLocalPub(info.externalId, nextName);
    usePubStore.getState().bumpCatalogRevision();
  }
  void clearPubsSnapshot();

  const pubForCorrection: Pub = {
    id: info.externalId ?? '',
    name: currentName,
    lat: info.lat,
    lng: info.lng,
    ...(info.city ? { city: info.city } : {}),
  };
  return enqueuePubNameCorrection(buildPubNameCorrectionEntry(pubForCorrection, nextName));
}
