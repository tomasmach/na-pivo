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

/**
 * Inverse of {@link geohash8}: decode a geohash-8 string back to the CENTRE of
 * the cell it names. This is the exact inversion of the encoder above — same
 * BASE32 alphabet, same longitude-first 5-bits-per-char bit order — so the
 * round-trip identity holds for every valid hash:
 *
 *   geohash8(decodeGeohash8(h)) === h
 *
 * We need it because the local pub-rating store keys ratings only by their
 * geohash-8 `pubKey` and never stores the lat/lng that produced them. To push a
 * rating to the backend (which re-derives the same cache_key from lat/lng) we
 * reconstruct a representative coordinate from the key — the cell centre, which
 * is guaranteed to re-encode to the same cell.
 *
 * Each character contributes 5 bits, alternating longitude/latitude (longitude
 * first). We progressively bisect the lat/lng ranges following each bit, then
 * return the midpoint of the final ranges — the cell centre.
 */
export function decodeGeohash8(hash: string): { lat: number; lng: number } {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;

  let even = true; // even bit refines longitude, odd refines latitude

  for (const char of hash) {
    const cd = BASE32.indexOf(char);
    if (cd === -1) continue; // skip any stray non-base32 character defensively
    // Walk the 5 bits of this char from most- to least-significant, exactly
    // mirroring how the encoder shifted them in.
    for (let mask = 16; mask >= 1; mask >>= 1) {
      const bitSet = (cd & mask) !== 0;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (bitSet) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitSet) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }

  return {
    lat: (latMin + latMax) / 2,
    lng: (lngMin + lngMax) / 2,
  };
}
