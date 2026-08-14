import type { Region } from 'react-native-maps';

import { clusterCoordinates, type MapCluster } from '@/map/mapModel';
import type { PubPresentation } from '@/pubs/pubPresentation';

export type PubsMapPoint = {
  lat: number;
  lng: number;
  pub: PubPresentation;
};

export type PubsMapGrid = {
  columns: number;
  rows: number;
  maxLabels: number;
};

/** One marker cell is deliberately about a thumb wider than a cluster bubble.
 *  That keeps the visible map calm even when the backend returns its full cap. */
export function pubsMapGrid(width: number, visibleHeight: number): PubsMapGrid {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(visibleHeight, 1);
  return {
    columns: Math.max(3, Math.min(6, Math.round(safeWidth / 104))),
    rows: Math.max(3, Math.min(10, Math.round(safeHeight / 104))),
    maxLabels: Math.max(2, Math.min(5, Math.round(safeHeight / 180))),
  };
}

/** Cluster the complete loaded catalogue first and only then cull off-screen
 *  cells. A pub crossing the render edge therefore cannot change the count,
 *  key or centre of a cluster that is already visible. */
export function buildPubsMapClusters(
  pubs: readonly PubPresentation[],
  region: Region,
  selectedId: string | null | undefined,
  grid: PubsMapGrid,
): MapCluster<PubsMapPoint>[] {
  const points = pubs
    .filter((pub) => pub.id !== selectedId)
    .map((pub) => ({ lat: pub.pub.lat, lng: pub.pub.lng, pub }));
  const clusters = clusterCoordinates(points, region, grid.columns, grid.rows);
  const latMargin = region.latitudeDelta * 0.55;
  const lngMargin = region.longitudeDelta * 0.55;
  return clusters
    .filter(
      (cluster) =>
        Math.abs(cluster.lat - region.latitude) <= latMargin &&
        Math.abs(cluster.lng - region.longitude) <= lngMargin,
    )
    .sort((a, b) => {
      const aDistance =
        Math.abs(a.lat - region.latitude) / region.latitudeDelta +
        Math.abs(a.lng - region.longitude) / region.longitudeDelta;
      const bDistance =
        Math.abs(b.lat - region.latitude) / region.latitudeDelta +
        Math.abs(b.lng - region.longitude) / region.longitudeDelta;
      return aDistance - bDistance || a.id.localeCompare(b.id);
    })
    .slice(0, grid.columns * grid.rows);
}
