import type { LatLng, Region } from 'react-native-maps';


import type { TourStop } from './model';

export const DEFAULT_TOUR_REGION: Region = {
  latitude: 49.82, longitude: 15.47, latitudeDelta: 4.7, longitudeDelta: 4.2,
};

const MIN_FIT_SPAN = 0.002;

/** Fitting one point zooms Google Maps to its maximum, where the gray style is a blank surface. */
export function tourFitCoordinates(stops: readonly TourStop[]): LatLng[] {
  const coords = stops.map((stop) => ({ latitude: stop.lat, longitude: stop.lon }));
  if (!coords.length) return coords;
  const lats = stops.map((stop) => stop.lat);
  const lons = stops.map((stop) => stop.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  if (maxLat - minLat >= MIN_FIT_SPAN || maxLon - minLon >= MIN_FIT_SPAN) return coords;
  const lat = (minLat + maxLat) / 2, lon = (minLon + maxLon) / 2, half = MIN_FIT_SPAN / 2;
  return [...coords, { latitude: lat - half, longitude: lon - half }, { latitude: lat + half, longitude: lon + half }];
}

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
