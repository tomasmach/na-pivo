type Point = { lat: number; lng: number };
type Pin = Point & { id: string };
type Viewport = { longitudeDelta: number };

/** One marker on the map: a pub on its own, or the bubble of several pubs. */
export type PinNode<P extends Pin = Pin> = Point & { key: string; members: P[]; lead: P; x: number; y: number };

/** A pub joins a cluster this close to its first pub, in points. Keeps bubbles apart on screen. */
const RADIUS_PT = 64;
/** Bubble centres closer than this, in points, would overlap (a bubble is up to 38 pt wide). */
const BUBBLE_GAP_PT = 42;
/** From this Google zoom on every pub has its own pin, even when two share a street corner. */
export const NO_CLUSTER_ZOOM = 17;
const LEVEL_STEP = 0.25;
const LEVEL_SLACK = 0.04;

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

/** Whether two bubbles this far apart would overlap on screen at this zoom. */
export function bubblesOverlap(a: Point, b: Point, zoom: number): boolean {
  const ptToDeg = 360 / (256 * 2 ** zoom);
  return Math.hypot(a.lng - b.lng, mercatorY(a.lat) - mercatorY(b.lat)) < BUBBLE_GAP_PT * ptToDeg;
}

/**
 * The zoom step whose groups the map shows. It leaves `current` only once the zoom is clearly
 * past its edge, so a pinch held on a boundary does not regroup the pins back and forth. The zoom
 * where clusters end has no such slack: a tap on a cluster stops exactly there.
 */
export function clusterLevel(zoom: number, current?: number): number {
  if (zoom >= NO_CLUSTER_ZOOM) return NO_CLUSTER_ZOOM;
  if (current !== undefined && zoom >= current - LEVEL_SLACK && zoom < current + LEVEL_STEP + LEVEL_SLACK) return current;
  return Math.max(0, Math.min(NO_CLUSTER_ZOOM, Math.floor(zoom / LEVEL_STEP) * LEVEL_STEP));
}

export function pinNode<P extends Pin>(pin: P): PinNode<P> {
  return { key: pin.id, lat: pin.lat, lng: pin.lng, x: pin.lng, y: mercatorY(pin.lat), members: [pin], lead: pin };
}

function join<P extends Pin>(parts: PinNode<P>[]): PinNode<P> {
  if (parts.length === 1) return parts[0];
  let count = 0;
  let x = 0;
  let y = 0;
  let biggest = parts[0];
  for (const part of parts) {
    count += part.members.length;
    x += part.x * part.members.length;
    y += part.y * part.members.length;
    if (part.members.length > biggest.members.length) biggest = part;
  }
  x /= count;
  y /= count;
  return { key: `c:${biggest.lead.id}`, lat: latOf(y), lng: x, x, y, members: parts.flatMap((part) => part.members), lead: biggest.lead };
}

function mergeLevel<P extends Pin>(finer: PinNode<P>[], level: number): PinNode<P>[] {
  const ptToDeg = 360 / (256 * 2 ** level);
  const radius = RADIUS_PT * ptToDeg;
  const gap = BUBBLE_GAP_PT * ptToDeg;
  const sorted = [...finer].sort((a, b) => a.x - b.x || a.y - b.y);
  const taken = new Array<boolean>(sorted.length).fill(false);
  const nodes: PinNode<P>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (taken[i]) continue;
    const seed = sorted[i];
    const parts = [seed];
    for (let j = i + 1; j < sorted.length && sorted[j].x - seed.x <= radius; j++) {
      if (!taken[j] && Math.hypot(sorted[j].x - seed.x, sorted[j].y - seed.y) <= radius) {
        taken[j] = true;
        parts.push(sorted[j]);
      }
    }
    nodes.push(join(parts));
  }
  for (let merged = true; merged; ) {
    merged = false;
    nodes.sort((a, b) => a.x - b.x);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length && nodes[j].x - nodes[i].x < gap; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if ((a.members.length > 1 || b.members.length > 1) && Math.hypot(a.x - b.x, a.y - b.y) < gap) {
          nodes[i] = join([a, b]);
          nodes.splice(j, 1);
          merged = true;
          j--;
        }
      }
    }
  }
  return nodes;
}

/**
 * Groups pins that would overlap, one grouping per zoom step. Every group of a step is made of
 * whole groups of the next finer step, so zooming only ever splits a bubble or joins bubbles, and
 * a pan keeps the groups as they are. A group keeps the key of its biggest part.
 */
export function clusterIndex<P extends Pin>(pins: readonly P[]): (level: number) => PinNode<P>[] {
  const levels = new Map<number, PinNode<P>[]>();
  const at = (level: number): PinNode<P>[] => {
    let nodes = levels.get(level);
    if (!nodes) {
      nodes = level >= NO_CLUSTER_ZOOM ? pins.map(pinNode) : mergeLevel(at(level + LEVEL_STEP), level);
      levels.set(level, nodes);
    }
    return nodes;
  };
  return (level) => at(clusterLevel(level));
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
