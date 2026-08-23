import type { PermissionState } from '@/compass/permissions';

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
