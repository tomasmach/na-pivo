type Point = { lat: number; lng: number };
type Viewport = { longitudeDelta: number };

export type PinCluster<P extends Point = Point> = Point & { key: string; count: number; members: P[] };

/** A pub joins a cluster this close to its first pub, in points. Keeps bubbles apart on screen. */
const RADIUS_PT = 64;
/** Bubble centres closer than this, in points, would overlap (a bubble is up to 38 pt wide). */
const BUBBLE_GAP_PT = 42;
/** From this Google zoom on every pub has its own pin, even when two share a street corner. */
export const NO_CLUSTER_ZOOM = 17;

function mercatorY(lat: number): number {
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 180) / Math.PI;
}

function latOf(y: number): number {
  return (Math.atan(Math.sinh((y * Math.PI) / 180)) * 180) / Math.PI;
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
): { singles: P[]; clusters: PinCluster<P>[] } {
  if (pins.length < 2 || zoomOf(viewport, widthPt) >= NO_CLUSTER_ZOOM) return { singles: [...pins], clusters: [] };
  const zoom = Math.floor(zoomOf(viewport, widthPt) * 4) / 4;
  const ptToDeg = 360 / (256 * 2 ** zoom);
  const radius = RADIUS_PT * ptToDeg;
  const points = pins
    .map((pin) => ({ pin, x: pin.lng, y: mercatorY(pin.lat) }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const taken = new Array<boolean>(points.length).fill(false);
  type Group = { key: string; members: P[]; x: number; y: number };
  const groups: Group[] = [];
  for (let i = 0; i < points.length; i++) {
    if (taken[i]) continue;
    const seed = points[i];
    const group: Group = { key: `${zoom}:${seed.x}:${seed.y}`, members: [seed.pin], x: seed.x, y: seed.y };
    // Points are sorted by x, so the scan stops once x is out of reach.
    for (let j = i + 1; j < points.length && points[j].x - seed.x <= radius; j++) {
      if (!taken[j] && Math.hypot(points[j].x - seed.x, points[j].y - seed.y) <= radius) {
        taken[j] = true;
        group.members.push(points[j].pin);
        group.x += points[j].x;
        group.y += points[j].y;
      }
    }
    group.x /= group.members.length;
    group.y /= group.members.length;
    groups.push(group);
  }
  // A bubble sits in the middle of its pubs, which can bring it onto a neighbour; merge those.
  const gap = BUBBLE_GAP_PT * ptToDeg;
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i];
        const b = groups[j];
        if ((a.members.length > 1 || b.members.length > 1) && Math.hypot(a.x - b.x, a.y - b.y) < gap) {
          const n = a.members.length + b.members.length;
          a.x = (a.x * a.members.length + b.x * b.members.length) / n;
          a.y = (a.y * a.members.length + b.y * b.members.length) / n;
          a.members.push(...b.members);
          groups.splice(j, 1);
          merged = true;
          j--;
        }
      }
    }
  }
  const singles: P[] = [];
  const clusters: PinCluster<P>[] = [];
  for (const g of groups) {
    if (g.members.length === 1) singles.push(g.members[0]);
    else clusters.push({ key: g.key, lat: latOf(g.y), lng: g.x, count: g.members.length, members: g.members });
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
  return {
    center: { latitude: latOf((Math.max(...ys) + Math.min(...ys)) / 2), longitude: (Math.max(...xs) + Math.min(...xs)) / 2 },
    zoom,
  };
}

/**
 * The pin of the pub the compass points at. Its key is a geohash cell that a neighbouring pub can
 * share, so among the pins of that cell it is the one standing on the target itself.
 */
export function targetPin<P extends Point & { key: string }>(pins: readonly P[], target: (Point & { key: string }) | null): P | undefined {
  if (!target) return undefined;
  let best: P | undefined;
  for (const pin of pins) {
    if (pin.key !== target.key) continue;
    if (!best || Math.hypot(pin.lat - target.lat, pin.lng - target.lng) < Math.hypot(best.lat - target.lat, best.lng - target.lng)) best = pin;
  }
  return best;
}
