/**
 * Pure helpers behind the "Kde sedíš?" sheet: what a pub row says, how a
 * typed name matches the pubs the phone already knows, and how the phone's
 * own list and the backend's suggestions become one list.
 */

import { formatDistanceCs, haversineMeters } from '@/compass/distance';
import { geohash8 } from '@/data/geohash';
import type { PubLocationSuggestion } from '@/data/mapyClient';
import type { Pub } from '@/data/pubs';
import { t } from '@/i18n';
import { presentOpenStatus } from '@/pubs/pubPresentation';

export interface PickRow {
  pub: Pub;
  distanceMeters: number | null;
}

/** "40 m · Otevřeno do 23:00 · Plzeň 12° · 59 Kč" — whatever is known. */
export function pickPubRowMeta(pub: Pub, distanceMeters: number | null): string {
  const tap = pub.beers?.[0];
  return [
    distanceMeters === null ? null : formatDistanceCs(distanceMeters),
    presentOpenStatus(pub).label,
    tap
      ? `${tap.name}${typeof tap.priceCzk === 'number' ? ` · ${t.liveParty.tapPrice(tap.priceCzk)}` : ''}`
      : null,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Case- and diacritic-insensitive name match: "kotv" finds "U Kotvy". */
export function pubMatchesTerm(pub: Pick<Pub, 'name' | 'city'>, term: string): boolean {
  const needle = fold(term);
  if (!needle) return false;
  return fold(pub.name).includes(needle) || (!!pub.city && fold(pub.city).includes(needle));
}

/**
 * One row per pub, whichever source named it. The phone's own list and the
 * backend's suggestions carry different ids for the same place, so identity
 * is the folded name plus a ~150 m cell (geohash-7) — "U Pinkasů" from both
 * lands on one row, two different "U Pinkasů" 5 km apart stay two.
 */
export function pubIdentity(pub: Pick<Pub, 'name' | 'lat' | 'lng'>): string {
  return `${fold(pub.name)}|${geohash8(pub.lat, pub.lng).slice(0, 7)}`;
}

export function dedupePubs<T extends Pick<Pub, 'name' | 'lat' | 'lng'>>(pubs: readonly T[]): T[] {
  const seen = new Set<string>();
  return pubs.filter((pub) => {
    const key = pubIdentity(pub);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const validCoordinate = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

/**
 * Local hits first (they answer offline and carry hours and taps), then the
 * backend's suggestions that are not already there, capped after the merge
 * so a long local list never hides a suggestion by itself.
 */
export function mergePickPubResults(
  local: readonly Pub[],
  suggestions: readonly PubLocationSuggestion[],
  position: { lat: number; lng: number } | null,
  limit: number,
): PickRow[] {
  const merged: Pub[] = local.slice();
  for (const suggestion of suggestions) {
    const { lat, lng } = suggestion;
    if (!validCoordinate(lat, lng) || typeof lng !== 'number') continue;
    merged.push({
      id: suggestion.id,
      name: suggestion.name,
      lat,
      lng,
      ...(suggestion.city ? { city: suggestion.city } : {}),
      ...(suggestion.address ? { address: suggestion.address } : {}),
      ...(suggestion.placeId ? { googlePlaceId: suggestion.placeId } : {}),
    });
  }
  return dedupePubs(merged)
    .slice(0, limit)
    .map((pub) => ({
      pub,
      distanceMeters: position ? haversineMeters(position, pub) : null,
    }));
}
