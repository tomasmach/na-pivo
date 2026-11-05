type Point = { lat: number; lng: number };
type Viewport = { longitudeDelta: number };

export type PinCluster = Point & { key: string; count: number; members: Point[] };

/** Two clusters never sit closer than this on screen, in points, so their bubbles do not overlap. */
const RADIUS_PT = 64;
/** From this Google zoom on every pub has its own pin, even when two share a street corner. */
export const NO_CLUSTER_ZOOM = 17;

function mercatorY(lat: number): number {
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 180) / Math.PI;
}

/** Google zoom of a viewport `widthPt` points wide. */
export function zoomOf(viewport: Viewport, widthPt: number): number {
  return Math.log2((360 * widthPt) / (256 * Math.max(viewport.longitudeDelta, 1e-9)));
}

/**
 * Groups pins that would overlap. Each cluster sits on its first pub, and every other pub within
 * the radius joins it. The radius snaps to a power of two and the order does not depend on the
 * viewport, so a pan keeps the same groups and only a zoom step regroups them.
 */
export function clusterPins<P extends Point>(
  pins: readonly P[],
  viewport: Viewport,
  widthPt: number,
): { singles: P[]; clusters: PinCluster[] } {
  if (pins.length < 2 || zoomOf(viewport, widthPt) >= NO_CLUSTER_ZOOM) return { singles: [...pins], clusters: [] };
  const radius = 2 ** Math.round(Math.log2((viewport.longitudeDelta * RADIUS_PT) / widthPt));
  const points = pins
    .map((pin) => ({ pin, x: pin.lng, y: mercatorY(pin.lat) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const taken = new Array<boolean>(points.length).fill(false);
  const singles: P[] = [];
  const clusters: PinCluster[] = [];
  for (let i = 0; i < points.length; i++) {
    if (taken[i]) continue;
    const seed = points[i];
    const members: P[] = [seed.pin];
    // Points are sorted by x, so the scan stops once x is out of reach.
    for (let j = i + 1; j < points.length && points[j].x - seed.x <= radius; j++) {
      if (!taken[j] && Math.abs(points[j].y - seed.y) <= radius && Math.hypot(points[j].x - seed.x, points[j].y - seed.y) <= radius) {
        taken[j] = true;
        members.push(points[j].pin);
      }
    }
    if (members.length === 1) singles.push(seed.pin);
    else clusters.push({ key: `${radius}:${seed.x}:${seed.y}`, lat: seed.pin.lat, lng: seed.pin.lng, count: members.length, members });
  }
  return { singles, clusters };
}
