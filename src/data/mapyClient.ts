/**
 * Mapy.cz REST API client — POI search for pubs/bars.
 *
 * Strategy: 4 parallel /v1/geocode queries (hospoda, bar, pivnice, pivovar)
 * around a bbox derived from the user's position. Results are deduplicated by
 * coordinate and filtered to pub-ish labels.
 */

import type { Pub } from './pubs';

const BASE_URL = 'https://api.mapy.cz/v1/geocode';
const USER_AGENT = 'napivo-ios/1.0';

const QUERY_TERMS = ['hospoda', 'bar', 'pivnice', 'pivovar'];
const MAX_RESULTS_PER_QUERY = 15; // Mapy.cz API limit.

// Mapy.cz returns mixed categories under our text queries. Keep only the ones
// that match a place where you can actually drink a beer.
const ALLOWED_LABELS = new Set<string>([
  'Hospoda',
  'Bar',
  'Pivovar',
  'Pivnice',
  'Restaurace a pohostinství',
  'Vinárna',
  'Klub',
]);

interface MapyPosition {
  lat: number;
  lon: number;
}

interface MapyGeocodeItem {
  name: string;
  label?: string;
  position: MapyPosition;
  location?: string;
  zip?: string;
  regionalStructure?: Array<{ name: string; type: string }>;
}

interface MapyGeocodeResponse {
  items?: MapyGeocodeItem[];
}

// Read at module top-level so Metro inlines the value at bundle time.
const MAPY_API_KEY = process.env.EXPO_PUBLIC_MAPY_API_KEY ?? '';

function getApiKey(): string {
  return MAPY_API_KEY;
}

/**
 * Convert (lat, lng, kmRadius) → "lonMin,latMin,lonMax,latMax" string for Mapy preferBBox.
 * Approximation: 1° lat ≈ 111 km; 1° lng ≈ 111 km * cos(lat).
 */
function buildPreferBBox(lat: number, lng: number, kmRadius: number): string {
  const dLat = kmRadius / 111;
  const dLng = kmRadius / (111 * Math.cos((lat * Math.PI) / 180));
  return `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
}

function pickCity(item: MapyGeocodeItem): string | undefined {
  const rs = item.regionalStructure;
  if (!rs) return undefined;
  // Prefer municipality, fall back to municipality_part.
  const municipality = rs.find((r) => r.type === 'regional.municipality');
  if (municipality) return municipality.name;
  const part = rs.find((r) => r.type === 'regional.municipality_part');
  return part?.name;
}

function pickAddress(item: MapyGeocodeItem): string | undefined {
  const rs = item.regionalStructure;
  if (!rs) return undefined;
  const street = rs.find((r) => r.type === 'regional.street')?.name;
  const num = rs.find((r) => r.type === 'regional.address')?.name;
  if (street && num) return `${street} ${num}`;
  if (street) return street;
  return undefined;
}

async function geocodeQuery(
  query: string,
  preferBBox: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<MapyGeocodeItem[]> {
  const url = new URL(BASE_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('lang', 'cs');
  url.searchParams.set('limit', String(MAX_RESULTS_PER_QUERY));
  url.searchParams.set('preferBBox', preferBBox);
  url.searchParams.set('apikey', apiKey);

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    signal,
  });
  if (!resp.ok) {
    throw new Error(`Mapy.cz geocode ${query}: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as MapyGeocodeResponse;
  return data.items ?? [];
}

/**
 * Fetch pubs near the given coordinate from Mapy.cz.
 * Throws if the API key is missing or all requests fail.
 */
export async function searchPubsNear(
  lat: number,
  lng: number,
  kmRadius = 25,
  signal?: AbortSignal,
): Promise<Pub[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MAPY_API_KEY is not configured');
  }

  const preferBBox = buildPreferBBox(lat, lng, kmRadius);

  const settled = await Promise.allSettled(
    QUERY_TERMS.map((term) => geocodeQuery(term, preferBBox, apiKey, signal)),
  );

  const items: MapyGeocodeItem[] = [];
  let allFailed = true;
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      allFailed = false;
      items.push(...result.value);
    }
  }
  if (allFailed) {
    throw new Error('All Mapy.cz geocode queries failed');
  }

  // Dedupe by coordinate (~1m precision is plenty).
  const seen = new Set<string>();
  const pubs: Pub[] = [];
  for (const item of items) {
    if (!item.label || !ALLOWED_LABELS.has(item.label)) continue;
    if (!item.name || !item.position) continue;

    const key = `${item.position.lat.toFixed(5)},${item.position.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const pub: Pub = {
      id: `mapy:${key}`,
      name: item.name.trim(),
      lat: item.position.lat,
      lng: item.position.lon,
    };
    const address = pickAddress(item);
    if (address) pub.address = address;
    const city = pickCity(item);
    if (city) pub.city = city;

    pubs.push(pub);
  }

  return pubs;
}
