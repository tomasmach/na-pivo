

export function compassArrowRotation(bearing: number, heading: number): number {
  'worklet';

  return (bearing - heading + 360) % 360;
}
