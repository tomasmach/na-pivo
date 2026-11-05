import { clusterPins, zoomOf } from '../clusterPins';

const WIDTH = 390;
const city = { longitudeDelta: 0.2 };
const street = { longitudeDelta: 0.002 };

describe('clusterPins', () => {
  it('groups pubs that would overlap and keeps a lone pub as its own pin', () => {
    const pins = [
      { id: 'a', lat: 50.0806, lng: 14.428 },
      { id: 'b', lat: 50.0807, lng: 14.4281 },
      { id: 'c', lat: 50.0808, lng: 14.4282 },
      { id: 'far', lat: 49.19, lng: 16.6 },
    ];
    const { singles, clusters } = clusterPins(pins, city, WIDTH);
    expect(singles.map((p) => p.id)).toEqual(['far']);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
    expect(clusters[0].lat).toBe(50.0806);
  });

  it('shows every pub on its own at street zoom', () => {
    expect(zoomOf(street, WIDTH)).toBeGreaterThan(17);
    const pins = [
      { lat: 50.0806, lng: 14.428 },
      { lat: 50.0806, lng: 14.42801 },
    ];
    expect(clusterPins(pins, street, WIDTH)).toEqual({ singles: pins, clusters: [] });
  });

  it('keeps the same groups when the map only pans', () => {
    const pins = Array.from({ length: 200 }, (_, i) => ({ lat: 50 + (i % 20) * 0.003, lng: 14.4 + Math.floor(i / 20) * 0.004 }));
    const before = clusterPins(pins, { longitudeDelta: 0.1 }, WIDTH).clusters.map((c) => `${c.key}:${c.count}`);
    const after = clusterPins(pins, { longitudeDelta: 0.1 + 1e-9 }, WIDTH).clusters.map((c) => `${c.key}:${c.count}`);
    expect(after).toEqual(before);
  });
});
