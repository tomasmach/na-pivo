import type { Pub } from '@/data/pubs';
import type { PubPresentation } from '@/pubs/pubPresentation';
import { buildPubsMapClusters, pubsMapGrid } from '@/pubs/pubsMapModel';

function presentation(id: string, lat: number, lng: number): PubPresentation {
  const pub = { id, name: id, lat, lng } as Pub;
  return {
    pub,
    id,
    name: id,
    address: 'Praha',
    distanceMeters: null,
    distanceLabel: null,
    distanceValue: null,
    distanceUnit: null,
    openState: 'unknown',
    openLabel: 'Otevírací doba neznámá',
    featuredTap: null,
    beerLine: null,
    rating: null,
    ratingLabel: null,
    hasGarden: false,
    hasTankBeer: false,
    visitCount: 0,
    lastVisitedAt: null,
  };
}

const REGION = {
  latitude: 50.08,
  longitude: 14.43,
  latitudeDelta: 0.025,
  longitudeDelta: 0.025,
};

describe('pubs map marker model', () => {
  it('derives a calm marker grid from the actually visible map area', () => {
    expect(pubsMapGrid(402, 410)).toEqual({ columns: 4, rows: 4, maxLabels: 2 });
    expect(pubsMapGrid(402, 720)).toEqual({ columns: 4, rows: 7, maxLabels: 4 });
  });

  it('keeps a dense default viewport below the grid cell ceiling', () => {
    const pubs = Array.from({ length: 300 }, (_, index) => {
      const row = Math.floor(index / 20);
      const column = index % 20;
      return presentation(
        `pub-${index}`,
        REGION.latitude - 0.012 + row * 0.0016,
        REGION.longitude - 0.012 + column * 0.00125,
      );
    });

    const clusters = buildPubsMapClusters(pubs, REGION, null, pubsMapGrid(402, 410));

    expect(clusters.length).toBeLessThanOrEqual(16);
    expect(clusters.some((cluster) => cluster.items.length > 1)).toBe(true);
  });

  it('keeps pre-rendered edge cells inside the same marker ceiling', () => {
    const pubs = Array.from({ length: 144 }, (_, index) =>
      presentation(
        `edge-${index}`,
        REGION.latitude - 0.014 + Math.floor(index / 12) * 0.0024,
        REGION.longitude - 0.014 + (index % 12) * 0.0024,
      ),
    );
    const grid = pubsMapGrid(402, 410);

    expect(buildPubsMapClusters(pubs, REGION, null, grid).length).toBeLessThanOrEqual(
      grid.columns * grid.rows,
    );
  });

  it('does not reshuffle shared clusters during a pan at the same zoom', () => {
    const pubs = Array.from({ length: 80 }, (_, index) =>
      presentation(
        `pub-${index}`,
        REGION.latitude - 0.014 + Math.floor(index / 10) * 0.0035,
        REGION.longitude - 0.014 + (index % 10) * 0.003,
      ),
    );
    const grid = pubsMapGrid(402, 410);
    const before = buildPubsMapClusters(pubs, REGION, null, grid);
    const after = buildPubsMapClusters(
      pubs,
      { ...REGION, latitude: REGION.latitude + 0.004, longitude: REGION.longitude + 0.003 },
      null,
      grid,
    );
    const membership = (cluster: (typeof before)[number]) =>
      cluster.items.map((item) => item.pub.id).sort();
    const afterById = new Map(after.map((cluster) => [cluster.id, membership(cluster)]));
    const shared = before.filter((cluster) => afterById.has(cluster.id));

    expect(shared.length).toBeGreaterThan(0);
    for (const cluster of shared) {
      expect(afterById.get(cluster.id)).toEqual(membership(cluster));
    }
  });

  it('renders an explicit selection separately from its cluster', () => {
    const pubs = [
      presentation('selected', 50.08, 14.43),
      presentation('other', 50.0801, 14.4301),
    ];

    const clusters = buildPubsMapClusters(pubs, REGION, 'selected', pubsMapGrid(402, 410));

    expect(clusters.flatMap((cluster) => cluster.items.map((item) => item.pub.id))).toEqual([
      'other',
    ]);
  });
});
