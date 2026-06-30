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
  const userLat = userPos?.lat;
  const userLng = userPos?.lng;
  const targetLat = targetPub?.lat;
  const targetLng = targetPub?.lng;

  return useMemo(() => {
    if (userLat == null || userLng == null || targetLat == null || targetLng == null) {
      return { bearing: null, distanceMeters: null };
    }

    const bearing = initialBearing({
      lat1: userLat,
      lng1: userLng,
      lat2: targetLat,
      lng2: targetLng,
    });

    const distanceMeters = haversineMeters(
      { lat: userLat, lng: userLng },
      { lat: targetLat, lng: targetLng },
    );

    return { bearing, distanceMeters };
  }, [targetLat, targetLng, userLat, userLng]);
}
