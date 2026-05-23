/**
 * Pure bearing math. No React, no side effects.
 */

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export interface BearingInput {
  lat1: number;
  lng1: number;
  lat2: number;
  lng2: number;
}

/**
 * Returns the initial bearing (forward azimuth) from point 1 to point 2, in degrees [0, 360).
 *
 * Formula: θ = atan2(sin Δλ · cos φ₂, cos φ₁ · sin φ₂ − sin φ₁ · cos φ₂ · cos Δλ)
 */
export function initialBearing({ lat1, lng1, lat2, lng2 }: BearingInput): number {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δλ = toRadians(lng2 - lng1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  return ((toDegrees(θ) + 360) % 360);
}
