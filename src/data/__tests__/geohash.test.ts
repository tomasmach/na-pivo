import { geohash8 } from '../geohash';

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
