import type { PermissionState } from '@/compass/permissions';
import { geohash8 } from '@/data/geohash';
import type { FocusedPub } from '@/stores/focusedPubStore';
import {
  presentPub,
  type PubPosition,
  type PubPresentation,
  type PubVisitIndex,
} from '@/pubs/pubPresentation';

/**
 * The head cell while a friend's "Ukaž na kompasu" holds the needle (§F2).
 *
 * The handoff carries a coarse geohash-8 cell and a name, nothing else. When
 * that cell is a pub we already know, the head cell is that pub's real row and
 * still opens its detail (`real`). When it is not, it becomes a name and a
 * distance with nothing behind it — the same thing the 2.x compass card did
 * with a focused friend target.
 */
export function resolveCompassFocusHead(
  focusedPub: FocusedPub | null,
  presentations: readonly PubPresentation[],
  position: PubPosition | null,
  visits?: PubVisitIndex,
): { pub: PubPresentation; real: boolean } | null {
  if (!focusedPub) return null;
  const match = presentations.find(
    (candidate) => geohash8(candidate.pub.lat, candidate.pub.lng) === focusedPub.cacheKey,
  );
  if (match) return { pub: match, real: true };
  return {
    pub: presentPub(
      {
        id: `focus:${focusedPub.cacheKey}`,
        name: focusedPub.name,
        lat: focusedPub.lat,
        lng: focusedPub.lng,
      },
      position,
      visits,
    ),
    real: false,
  };
}

export type PubListEmptyState =
  | 'ready'
  | 'loading'
  | 'permission-denied'
  | 'location-unavailable'
  | 'search-failed'
  | 'empty';

export function resolvePubListEmptyState({
  pubCount,
  snapshotReady,
  fallbackSnapshotReady,
  hasPosition,
  isLoading,
  searchFailed,
  permissionState,
}: {
  pubCount: number;
  snapshotReady: boolean;
  fallbackSnapshotReady: boolean;
  hasPosition: boolean;
  isLoading: boolean;
  searchFailed: boolean;
  permissionState: PermissionState;
}): PubListEmptyState {
  if (pubCount > 0) return 'ready';
  if (!snapshotReady) return 'loading';
  if (permissionState === 'denied') return 'permission-denied';
  if (!hasPosition && fallbackSnapshotReady) return 'location-unavailable';
  if (isLoading) return 'loading';
  return searchFailed ? 'search-failed' : 'empty';
}
