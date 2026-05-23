/**
 * Derives bearing and distance to the target pub from the user's position.
 */

import { useMemo } from 'react';
import type { Pub } from '@/data/pubs';
import { initialBearing } from './bearing';
import { haversineMeters } from './distance';

export interface TargetBearingResult {
  bearing: number | null;
  distanceMeters: number | null;
}

export function useTargetBearing(
  userPos: { lat: number; lng: number } | null,
  targetPub: Pub | null,
): TargetBearingResult {
  return useMemo(() => {
    if (!userPos || !targetPub) {
      return { bearing: null, distanceMeters: null };
    }

    const bearing = initialBearing({
      lat1: userPos.lat,
      lng1: userPos.lng,
      lat2: targetPub.lat,
      lng2: targetPub.lng,
    });

    const distanceMeters = haversineMeters(
      { lat: userPos.lat, lng: userPos.lng },
      { lat: targetPub.lat, lng: targetPub.lng },
    );

    return { bearing, distanceMeters };
  }, [userPos?.lat, userPos?.lng, targetPub?.id]);
}
