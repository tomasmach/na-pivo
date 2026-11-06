type Point = { lat: number; lng: number };
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/**
 * Pins inside the part of the map a person can see. Google Maps already leaves the padded
 * bottom (pub card, tab bar) out of the region; the strip under the search bar and chips
 * at the top is cut here, so a pub counts as seen only when it is.
 */
export function visiblePins<P extends Point>(pins: readonly P[], region: Region, regionHeight: number, coveredTop: number): P[] {
  const covered = regionHeight > 0 ? Math.min(Math.max(coveredTop / regionHeight, 0), 1) : 0;
  const south = region.latitude - region.latitudeDelta / 2;
  const north = south + region.latitudeDelta * (1 - covered);
  const west = region.longitude - region.longitudeDelta / 2;
  const east = region.longitude + region.longitudeDelta / 2;
  return pins.filter((p) => p.lat <= north && p.lat >= south && p.lng >= west && p.lng <= east);
}
