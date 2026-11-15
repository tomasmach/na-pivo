import { bubblesOverlap, clusterCamera, clusterIndex, clusterLevel, NO_CLUSTER_ZOOM, targetPin, zoomOf } from '../clusterPins';

const WIDTH = 390;
const CITY = zoomOf({ longitudeDelta: 0.2 }, WIDTH);
const STREET = zoomOf({ longitudeDelta: 0.002 }, WIDTH);
const pin = (id: string, lat: number, lng: number) => ({ id, lat, lng });
const grid = Array.from({ length: 200 }, (_, i) => pin(`p${i}`, 50 + (i % 20) * 0.003, 14.4 + Math.floor(i / 20) * 0.004));

describe('clusterIndex', () => {
  it('groups pubs that would overlap and keeps a lone pub as its own pin', () => {
    const pins = [pin('a', 50.0806, 14.428), pin('b', 50.0807, 14.4281), pin('c', 50.0808, 14.4282), pin('far', 49.19, 16.6)];
    const nodes = clusterIndex(pins)(CITY);
    expect(nodes.filter((n) => n.members.length === 1).map((n) => n.key)).toEqual(['far']);
    const [cluster] = nodes.filter((n) => n.members.length > 1);
    expect(cluster.members).toHaveLength(3);
    expect(cluster.lat).toBeCloseTo(50.0807, 5);
  });

  it('tells when a cluster sits under another pin on screen', () => {
    const target = { lat: 50.0876, lng: 14.4211 };
    const cluster = { lat: 50.0879, lng: 14.4215 };
    expect(bubblesOverlap(cluster, target, CITY)).toBe(true);
    expect(bubblesOverlap(cluster, target, STREET)).toBe(false);
  });

  it('shows every pub on its own at street zoom', () => {
    expect(STREET).toBeGreaterThan(NO_CLUSTER_ZOOM);
    const pins = [pin('a', 50.0806, 14.428), pin('b', 50.0806, 14.42801)];
    expect(clusterIndex(pins)(STREET).map((n) => n.key)).toEqual(['a', 'b']);
  });

  it('keeps the same groups when the map only pans', () => {
    const groupsAt = clusterIndex(grid);
    expect(groupsAt(zoomOf({ longitudeDelta: 0.1 + 1e-9 }, WIDTH))).toBe(groupsAt(zoomOf({ longitudeDelta: 0.1 }, WIDTH)));
  });

  it('holds a zoom step until the zoom is clearly past its edge', () => {
    expect(clusterLevel(14.26)).toBe(14.25);
    expect(clusterLevel(14.26, 14)).toBe(14);
    expect(clusterLevel(14.3, 14)).toBe(14.25);
    expect(clusterLevel(13.97, 14)).toBe(14);
    expect(clusterLevel(13.9, 14)).toBe(13.75);
    expect(clusterLevel(19)).toBe(NO_CLUSTER_ZOOM);
    expect(clusterLevel(NO_CLUSTER_ZOOM, 16.75)).toBe(NO_CLUSTER_ZOOM);
    expect(clusterLevel(16.99, 16.75)).toBe(16.75);
  });

  it('builds every group from whole groups of the next finer step, under the key of its biggest part', () => {
    const groupsAt = clusterIndex(grid);
    for (let level = 9; level < NO_CLUSTER_ZOOM; level += 0.25) {
      const coarse = groupsAt(level);
      const fine = groupsAt(level + 0.25);
      expect(coarse.reduce((n, node) => n + node.members.length, 0)).toBe(grid.length);
      const parentOf = new Map(coarse.flatMap((node) => node.members.map((member) => [member.id, node] as const)));
      for (const node of fine) {
        expect(new Set(node.members.map((member) => parentOf.get(member.id))).size).toBe(1);
      }
      for (const node of coarse) {
        const parts = fine.filter((part) => parentOf.get(part.lead.id) === node);
        const biggest = Math.max(...parts.map((part) => part.members.length));
        expect(parts.filter((part) => part.members.length === biggest).map((part) => part.lead)).toContain(node.lead);
        expect(node.key).toBe(node.members.length === 1 ? node.lead.id : `c:${node.lead.id}`);
      }
    }
  });

  it('stops zooming in where clusters break apart, and fits a wide cluster whole', () => {
    const area = { width: 280, height: 400 };
    const close = clusterCamera([{ lat: 50.0806, lng: 14.428 }, { lat: 50.0807, lng: 14.4281 }], area);
    expect(close.zoom).toBe(NO_CLUSTER_ZOOM);
    expect(close.center.latitude).toBeCloseTo(50.08065, 5);
    const wide = clusterCamera([{ lat: 50.0, lng: 14.3 }, { lat: 50.1, lng: 14.5 }], area);
    expect(wide.zoom).toBeLessThan(13);
  });

  it('never leaves two bubbles on top of each other after centring them', () => {
    const ptToDeg = 360 / (256 * 2 ** 15);
    const pins = [0, 62, 63, 63.5, 64.5, 65].map((pt, i) => pin(`p${i}`, 50, 14.4 + pt * ptToDeg));
    const nodes = clusterIndex(pins)(15);
    const centres = nodes.map((n) => n.lng).sort((a, b) => a - b);
    const bubbles = nodes.filter((n) => n.members.length > 1);
    expect(bubbles.length).toBeGreaterThan(0);
    for (const bubble of bubbles) {
      for (const other of nodes) if (other !== bubble) expect(Math.abs(other.lng - bubble.lng) / ptToDeg).toBeGreaterThanOrEqual(42);
    }
    expect(centres).toHaveLength(nodes.length);
    expect(nodes.reduce((n, node) => n + node.members.length, 0)).toBe(6);
  });

  it('keeps out the target pub itself when a neighbour shares its geohash cell', () => {
    const a = { id: 'a', key: 'u2fkbm01', lat: 50.08137, lng: 14.42531 };
    const b = { id: 'b', key: 'u2fkbm01', lat: 50.08139, lng: 14.42535 };
    expect(targetPin([a, b], { key: b.key, lat: b.lat, lng: b.lng })).toBe(b);
    expect(targetPin([a, b], null)).toBeUndefined();
  });
});
