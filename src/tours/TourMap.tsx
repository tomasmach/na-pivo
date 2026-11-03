import type { Region } from 'react-native-maps';


import type { TourStop } from './model';

export const DEFAULT_TOUR_REGION: Region = {
  latitude: 49.82, longitude: 15.47, latitudeDelta: 4.7, longitudeDelta: 4.2,
};

export function tourRegion(stops: readonly TourStop[], height = 300): Region {
  if (!stops.length) return DEFAULT_TOUR_REGION;
  const lats = stops.map((stop) => stop.lat);
  const lons = stops.map((stop) => stop.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const padding = Math.max(1.55, height / Math.max(28, height - 88));
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.012, (maxLat - minLat) * padding),
    longitudeDelta: Math.max(0.012, (maxLon - minLon) * 1.55),
  };
}
