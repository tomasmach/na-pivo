/**
 * Shared tongue-position generator for the foam. Both FoamDrip (visual) and
 * FoamDrops (animation) consume this so drops emerge from the actual foam
 * tongues rather than floating in space.
 */

export interface FoamTongue {
  centerX: number;
  topY: number;
  bottomY: number;
  width: number;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

export function buildFoamTongues(width: number, foamBottom: number): FoamTongue[] {
  const count = Math.max(5, Math.round(width / 70));
  const tongues: FoamTongue[] = [];
  for (let i = 0; i < count; i++) {
    const baseFrac = (i + 0.5) / count + (seededRandom(i * 79) - 0.5) * 0.2;
    const longRoll = seededRandom(i * 91);
    const isLong = longRoll > 0.65;
    const length = isLong
      ? 50 + seededRandom(i * 83) * 50
      : 18 + seededRandom(i * 83) * 30;
    tongues.push({
      centerX: baseFrac * width,
      topY: foamBottom - 30,
      bottomY: foamBottom + length,
      width: 26 + seededRandom(i * 89) * 24,
    });
  }
  return tongues;
}
