type Point = { lat: number; lng: number };
type Viewport = { longitudeDelta: number };

export type PinCluster = Point & { key: string; count: number; members: Point[] };

/** A pub joins a cluster this close to its first pub, in points. Keeps bubbles apart on screen. */
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
 * Groups pins that would overlap. The zoom snaps to quarter steps and the order does not depend
 * on the viewport, so a pan keeps the same groups and only a zoom step regroups them.
 */
export function clusterPins<P extends Point>(
  pins: readonly P[],
  viewport: Viewport,
  widthPt: number,
): { singles: P[]; clusters: PinCluster[] } {
  if (pins.length < 2 || zoomOf(viewport, widthPt) >= NO_CLUSTER_ZOOM) return { singles: [...pins], clusters: [] };
  const zoom = Math.floor(zoomOf(viewport, widthPt) * 4) / 4;
  const radius = (RADIUS_PT * 360) / (256 * 2 ** zoom);
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
    if (members.length === 1) {
      singles.push(seed.pin);
      continue;
    }
    const lat = members.reduce((sum, m) => sum + m.lat, 0) / members.length;
    const lng = members.reduce((sum, m) => sum + m.lng, 0) / members.length;
    clusters.push({ key: `${zoom}:${seed.x}:${seed.y}`, lat, lng, count: members.length, members });
  }
  return { singles, clusters };
}

/**
 * The camera that shows every pub of a cluster inside `areaPt`, no closer than the zoom where
 * clusters break apart anyway, so the street around them stays recognisable.
 */
export function clusterCamera(members: readonly Point[], areaPt: { width: number; height: number }): { center: { latitude: number; longitude: number }; zoom: number } {
  const xs = members.map((m) => m.lng);
  const ys = members.map((m) => mercatorY(m.lat));
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const fit = (pt: number, span: number) => (span > 0 ? Math.log2((360 * pt) / (256 * span)) : NO_CLUSTER_ZOOM);
  const zoom = Math.min(NO_CLUSTER_ZOOM, fit(areaPt.width, spanX), fit(areaPt.height, spanY));
  const midY = ((Math.max(...ys) + Math.min(...ys)) / 2) * (Math.PI / 180);
  return {
    center: { latitude: (Math.atan(Math.sinh(midY)) * 180) / Math.PI, longitude: (Math.max(...xs) + Math.min(...xs)) / 2 },
    zoom,
  };
}
