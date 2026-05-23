/**
 * Mapy.cz REST API client — POI search for pubs/bars.
 *
 * Strategy: 4 parallel /v1/suggest queries (hospoda, bar, pivnice, pivovar)
 * with a tight bbox around the user. Suggest ranks by location, unlike
 * geocode which biases toward textual relevance. Results are deduplicated,
 * label-filtered, name-blocklisted, and clamped to the requested radius.
 */

import type { Pub } from './pubs';

// /v1/suggest is dramatically better than /v1/geocode for "POIs near me" —
// it ranks by location rather than textual relevance, so a small bbox around
// the user reliably surfaces local results instead of pushing back popular
// places from far away.
const BASE_URL = 'https://api.mapy.cz/v1/suggest';
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

// Chain restaurants labeled "Restaurace a pohostinství" that nobody goes to for
// a beer. Matched as a case-insensitive substring against the POI name.
const NAME_BLOCKLIST = [
  "mcdonald", // McDonald's
  "kfc",
  "burger king",
  "subway",
  "starbucks",
  "costa coffee",
];

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

async function suggestQuery(
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

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal,
    });
  } catch (err) {
    console.warn(`[mapy] fetch threw for "${query}":`, err);
    throw err;
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '<unreadable>');
    console.warn(`[mapy] "${query}" HTTP ${resp.status}: ${body.slice(0, 200)}`);
    throw new Error(`Mapy.cz suggest ${query}: HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as MapyGeocodeResponse;
  return data.items ?? [];
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nameIsBlocked(name: string): boolean {
  const lower = name.toLowerCase();
  return NAME_BLOCKLIST.some((needle) => lower.includes(needle));
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

  // Suggest ranks by proximity, so a tight bbox surfaces the local POIs we
  // care about. We then filter by true haversine distance below to enforce
  // the caller's radius precisely.
  const suggestBBox = buildPreferBBox(lat, lng, Math.min(kmRadius, 5));

  const settled = await Promise.allSettled(
    QUERY_TERMS.map((term) => suggestQuery(term, suggestBBox, apiKey, signal)),
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
    throw new Error('All Mapy.cz suggest queries failed');
  }

  // Dedupe by coordinate (~1m precision is plenty), filter labels and chain
  // restaurants, enforce true radius.
  const seen = new Set<string>();
  const pubs: Pub[] = [];
  for (const item of items) {
    if (!item.label || !ALLOWED_LABELS.has(item.label)) continue;
    if (!item.name || !item.position) continue;
    if (nameIsBlocked(item.name)) continue;

    const distance = haversineKm(lat, lng, item.position.lat, item.position.lon);
    if (distance > kmRadius) continue;

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
