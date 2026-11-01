import { geohash8 } from '@/data/geohash';

// TODO(merge): replace with buildPubShareUrl from src/data/pubShareLink.ts
// (built in parallel on the kompas branch); it returns the same URL.
export function pubShareUrl(pub: { name: string; lat: number; lng: number }): string {
  const name = pub.name.trim().slice(0, 120);
  const query = name ? `?n=${encodeURIComponent(name)}` : '';
  return `https://na-pivo.cz/h/${geohash8(pub.lat, pub.lng)}${query}`;
}
