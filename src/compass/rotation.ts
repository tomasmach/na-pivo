/**
 * Pure angle helpers for compass rotation.
 */

/**
 * Given a target angle and the current animated value, return the equivalent
 * target that minimises travel distance. This prevents long spins when the
 * arrow crosses 0°/360°.
 */
export function shortestRotationTarget(current: number, target: number): number {
  'worklet';

  let next = target;

  while (next - current > 180) next -= 360;
  while (current - next > 180) next += 360;

  return next;
}

export function compassArrowRotation(bearing: number, heading: number): number {
  'worklet';

  return (bearing - heading + 360) % 360;
}
