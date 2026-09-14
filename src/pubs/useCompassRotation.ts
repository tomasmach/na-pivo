/**
 * The needle, for any target.
 *
 * Extracted from `CompassCell` so the carousel over the map can put a live dial
 * on every card without each one re-deriving the maths. Same sensor stream,
 * same rotation helper, one source of truth — there is exactly one compass in
 * this app, it just gets drawn in several places.
 *
 * Returns a Reanimated shared value: the angle the arrow should point at, which
 * is the target's bearing MINUS wherever the phone is facing.
 */

import { useMemo } from 'react';
import {
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { initialBearing } from '@/compass/bearing';
import { shortestRotationTarget } from '@/compass/rotation';
import { useDeviceHeading } from '@/compass/useDeviceHeading';

const SPRING = { damping: 18, stiffness: 140, mass: 0.6 } as const;

export function useCompassRotation(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  enabled = true,
): SharedValue<number> {
  const { smoothedHeading } = useDeviceHeading(enabled);

  const bearing = useMemo(
    () => initialBearing({ lat1: from.lat, lng1: from.lng, lat2: to.lat, lng2: to.lng }),
    [from.lat, from.lng, to.lat, to.lng],
  );

  const rotation = useSharedValue(0);
  const lastTarget = useSharedValue(0);
  const hasTarget = useSharedValue(false);

  const arrow = useDerivedValue(() =>
    smoothedHeading.value === null ? null : bearing - smoothedHeading.value,
  );

  useAnimatedReaction(
    () => arrow.value,
    (target, previous) => {
      if (target === null || target === previous) return;
      const current = hasTarget.value ? lastTarget.value : rotation.value;
      const next = shortestRotationTarget(current, target);
      hasTarget.value = true;
      lastTarget.value = next;
      rotation.value = withSpring(next, SPRING);
    },
  );

  return rotation;
}
