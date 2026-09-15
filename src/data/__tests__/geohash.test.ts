import { geohash8, decodeGeohash8 } from '../geohash';

/**
 * Reference values generated from the backend's own encoder
 * (`geohash2.encode(lat, lng, precision=8)`). If any of these diverge the
 * client can no longer match server-side pub-report cache keys, so they act as
 * a contract test between the two repos.
 */
describe('geohash8', () => {
  const REFERENCE: Array<[number, number, string]> = [
    [57.64911, 10.40744, 'u4pruydq'], // classic geohash reference coordinate
    [50.0875, 14.4213, 'u2fkbnjk'], // Praha — Staroměstské náměstí
    [49.1951, 16.6068, 'u2ezcgsw'], // Brno
    [0.0, 0.0, '7zzzzzzz'], // null island
    [-33.8688, 151.2093, 'r3gx2f77'], // Sydney (southern + eastern hemisphere)
    [50.0876, 14.4201, 'u2fkbnhm'], // ~80 m from the Praha point → different cell
  ];

  it.each(REFERENCE)('encodes (%p, %p) to %p', (lat, lng, expected) => {
    expect(geohash8(lat, lng)).toBe(expected);
  });

  it('always returns a precision-8 hash', () => {
    expect(geohash8(50.0875, 14.4213)).toHaveLength(8);
    expect(geohash8(-33.8688, 151.2093)).toHaveLength(8);
  });

  it('puts two points in the same cell only when within the same ~38 m geohash box', () => {
    // Two coordinates a few metres apart share the cell key.
    expect(geohash8(50.08755, 14.42135)).toBe(geohash8(50.08756, 14.42136));
  });
});

describe('decodeGeohash8 (round-trip)', () => {
  const HASHES = ['u4pruydq', 'u2fkbnjk', 'u2ezcgsw', '7zzzzzzz', 'r3gx2f77', 'u2fkbnhm'];

  it.each(HASHES)('re-encodes the decoded centre of %p back to itself', (hash) => {
    const { lat, lng } = decodeGeohash8(hash);
    expect(geohash8(lat, lng)).toBe(hash);
  });

  it('returns the cell centre inside the [-90,90] / [-180,180] range', () => {
    const { lat, lng } = decodeGeohash8('u2fkbnjk');
    expect(lat).toBeGreaterThan(-90);
    expect(lat).toBeLessThan(90);
    expect(lng).toBeGreaterThan(-180);
    expect(lng).toBeLessThan(180);
  });

  it('round-trips a sweep of pseudo-random real coordinates', () => {
    let seed = 12345;
    const rand = () => {
      // Deterministic LCG so the test is reproducible.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const lat = rand() * 180 - 90;
      const lng = rand() * 360 - 180;
      const hash = geohash8(lat, lng);
      // The decoded centre must land in the SAME cell.
      expect(geohash8(decodeGeohash8(hash).lat, decodeGeohash8(hash).lng)).toBe(hash);
    }
  });
});
