/**
 * Great-circle distance (Haversine) and Czech distance formatter.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Returns the great-circle distance between two points in meters.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const sinΔφ = Math.sin(Δφ / 2);
  const sinΔλ = Math.sin(Δλ / 2);

  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_M * c;
}

/**
 * Formats a distance in meters using Czech locale conventions:
 *  - < 1000 m  → "320 m"    (rounded to nearest meter)
 *  - < 10 km   → "2,5 km"   (one decimal, Czech comma; trims trailing ",0")
 *  - >= 10 km  → "12 km"    (rounded to nearest km)
 */
export function formatDistanceCs(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  const km = meters / 1000;

  if (km < 10) {
    const rounded = Math.round(km * 10) / 10;
    // Format with one decimal, then replace "." with ","
    const str = rounded.toFixed(1).replace('.', ',');
    // Trim trailing ",0"
    return str.endsWith(',0') ? `${Math.round(km)} km` : `${str} km`;
  }

  return `${Math.round(km)} km`;
}
