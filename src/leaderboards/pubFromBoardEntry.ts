import type { PubBoardEntry } from '@/data/pubBoardClient';
import type { Pub } from '@/data/pubs';

/** The same id the pub catalogue gives this place, so the map merges them. */
export function pubFromBoardEntry(entry: PubBoardEntry): Pub {
  return {
    id: `mapy:${entry.lat.toFixed(5)},${entry.lng.toFixed(5)}`,
    name: entry.name,
    lat: entry.lat,
    lng: entry.lng,
    city: entry.city || undefined,
  };
}
