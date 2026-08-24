/**
 * Dedicated short-TTL cache for the "Zmapuj hospodu" public aggregate of ONE
 * pub, keyed by cache_key (= the local geohash-8 pubKey). Spec §4.6 mandates ONE
 * source per aggregate: these fields are deliberately STRIPPED from the 24h pubs
 * snapshot (see stripAmenitySummary), so the sheet reads from here instead — a
 * separate store with a ~6h TTL so a stale long-lived copy can never disagree
 * with the live sheet.
 *
 * On sheet open the flow is: read the cached aggregate immediately (instant
 * render), then fire a single-pub fetchPubAmenities([pubKey]) to refresh in the
 * background and overwrite the cache. AsyncStorage; never throws.
 */

import AsyncStorage from './privateAccountStorage';

import type { WireAmenityAggregate, WireAmenityCompleteness } from './pubAmenitiesClient';

const STORAGE_PREFIX = 'na-pivo-pub-amenities-snapshot:';
/** ~6h TTL — short enough that the public truth stays fresh, long enough to give
 *  an instant first paint without a network round-trip. */
const TTL_MS = 6 * 60 * 60 * 1000;

/** One cached pub aggregate snapshot. */
export interface CachedPubAmenities {
  amenities: WireAmenityAggregate[];
  completeness: WireAmenityCompleteness;
  mapperCount: number;
  savedAt: number;
}

function keyFor(pubKey: string): string {
  return `${STORAGE_PREFIX}${pubKey}`;
}

/** Read a pub's cached aggregate, or null when missing / expired / malformed. */
export async function readPubAmenitiesSnapshot(pubKey: string): Promise<CachedPubAmenities | null> {
  if (!pubKey) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(pubKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedPubAmenities>;
    if (
      !parsed ||
      !Array.isArray(parsed.amenities) ||
      !parsed.completeness ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null;
    }
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return {
      amenities: parsed.amenities,
      completeness: parsed.completeness,
      mapperCount: typeof parsed.mapperCount === 'number' ? parsed.mapperCount : 0,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/** Persist a pub's fresh aggregate. Fire-and-forget; never throws. */
export async function writePubAmenitiesSnapshot(
  pubKey: string,
  data: { amenities: WireAmenityAggregate[]; completeness: WireAmenityCompleteness; mapperCount: number },
): Promise<void> {
  if (!pubKey) return;
  try {
    const payload: CachedPubAmenities = {
      amenities: data.amenities,
      completeness: data.completeness,
      mapperCount: data.mapperCount,
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(keyFor(pubKey), JSON.stringify(payload));
  } catch {
    // A cache write failure just means the next open re-fetches; harmless.
  }
}
