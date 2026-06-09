/**
 * Standard (Niemeyer) geohash encoder — must stay bit-for-bit identical to the
 * backend's `geohash2.encode(lat, lng, precision=8)`.
 *
 * Pub reports are keyed server-side by a geohash-8 cell (~38 m × 19 m) so the
 * app can hide a place even when a later Mapy.cz search returns a different
 * provider id for the same physical location. To match those `cache_key`s
 * locally we have to reproduce the exact same encoding the backend uses.
 *
 * The algorithm interleaves longitude/latitude bits (longitude first) by
 * repeatedly bisecting the lat/lng ranges, packing 5 bits per base32 char.
 * The strict `>` midpoint comparison mirrors python-geohash exactly; only an
 * exact-midpoint coordinate could ever diverge, which real GPS data never hits.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash8(lat: number, lng: number): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true; // even step encodes longitude, odd encodes latitude

  while (hash.length < 8) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng > mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch = ch << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat > mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }

    even = !even;

    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}
