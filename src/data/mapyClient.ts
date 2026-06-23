/**
 * Mapy.cz REST API client — POI search for pubs/bars.
 *
 * Strategy: nearby-pub search goes through our own backend proxy, which calls
 * Mapy.cz and caches results so the app does not ship a production Mapy API key
 * or send background nearby-search requests directly to Mapy.cz. Raw Mapy items
 * returned by the backend are deduplicated, label-filtered, name-blocklisted,
 * and clamped to the radius.
 */

import type { Pub } from './pubs';
import { getBackendEndpoint } from './backendConfig';
import { trackApiFailure } from './telemetryClient';

// Mapy.cz returns mixed categories under our text queries. Keep only the ones
// that match a place where you can actually drink a beer. 'Vinárna' (wine bar)
// is intentionally absent — wine bars do not pour beer.
const ALLOWED_LABELS = new Set<string>([
  'Hospoda',
  'Bar',
  'Pivovar',
  'Pivnice',
  'Restaurace a pohostinství',
  'Klub',
]);

// Mapy.cz labels we treat as a curated "this is a pub" verdict: we trust the
// category outright and never run the negative-keyword filter against them.
// (Only the broad 'Restaurace a pohostinství', 'Bar' and 'Klub' buckets — which
// also catch sushi places, shisha lounges, cafés, etc. — get keyword-screened.)
const TRUSTED_PUB_LABELS = new Set<string>(['Hospoda', 'Pivnice', 'Pivovar']);

// Chain restaurants/cafés that nobody goes to for a beer. This is a HARD block:
// applied to every label, always, regardless of any positive keyword. Matched as
// a normalized substring against the POI name.
const NAME_BLOCKLIST = [
  'mcdonald', // McDonald's
  'kfc',
  'burger king',
  'subway',
  'starbucks',
  'costa coffee',
];

// Positive beer keywords. A match in the name is a strong "this is a pub" signal
// that OVERRIDES the negative filter — the place stays even under a screened
// label. Stored normalized (lowercase, no diacritics) so matching is cheap.
// Matched as whole-word prefixes (see nameMatchesKeyword), so "pivo" also catches
// "pivovar"/"pivnice" (desired) without firing on unrelated substrings.
const POSITIVE_NAME_KEYWORDS = [
  'hospoda', // also covers "hospůdka" via the "hosp" family below
  'hospudka',
  'hostinec',
  'pivnice',
  'pivovar',
  'pivni',
  'pivo',
  'pivoteka',
  'vycep',
  'senk',
  'tankovna',
  'nalevarna',
  'lokal',
  'pub',
  'beer',
].map(normalizeForMatch);

// Negative keywords. A name containing one of these (and NO positive keyword) is
// dropped — but ONLY for the screened labels (see TRUSTED_PUB_LABELS). Pizza /
// pizzerie are deliberately NOT here: that call is left to the backend verdict.
const NEGATIVE_NAME_KEYWORDS = [
  'sushi',
  'bistro',
  'kebab',
  'kavarna',
  'kafe',
  'cafe',
  'caffe',
  'coffee',
  'espresso',
  'cukrarna',
  'cajovna',
  'vinarna',
  'vinoteka',
  'shisha',
  'hookah',
  'zmrzlina',
  'gelato',
].map(normalizeForMatch);

// Negative keywords that must match a token EXACTLY, never as a prefix. "kava"
// as a prefix would also hit real pub names like "Restaurace Kavalír" or
// "Kavka Bar" — cafés are still caught by 'kavarna'/'kafe'/'cafe'/'coffee'.
const NEGATIVE_NAME_KEYWORDS_EXACT = ['kava'].map(normalizeForMatch);

interface MapyPosition {
  lat: number;
  lon: number;
}

interface MapyGeocodeItem {
  name: string;
  label?: string;
  position: MapyPosition;
  type?: string;
  location?: string;
  zip?: string;
  regionalStructure?: { name: string; type: string }[];
}

export interface PubLocationGeocodeInput {
  name: string;
  city?: string;
  address?: string;
  near?: { lat: number; lng: number } | null;
}

export interface PubLocationGeocodeResult {
  lat: number;
  lng: number;
  city?: string;
  address?: string;
  /** Mapy.cz result type, e.g. 'poi', 'regional.address', 'regional.municipality'. */
  type?: string;
}

// Mapy.cz result types that pin a concrete place (a POI or a real street
// address). Anything coarser — 'regional.municipality', 'regional.region',
// 'regional.country' — only resolves to the centroid of an area and must never
// be saved as a pub's location.
const SPECIFIC_GEOCODE_TYPES = new Set<string>([
  'poi',
  'regional.address',
  'regional.street',
]);

/** True when a geocode result pins a concrete place rather than an area centroid. */
export function isSpecificGeocodeResult(result: PubLocationGeocodeResult | null): boolean {
  return !!result && !!result.type && SPECIFIC_GEOCODE_TYPES.has(result.type);
}

export interface PubLocationSuggestion {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string;
  address?: string;
  location?: string;
}

/** Shape of the backend's pubs-near response. items are RAW Mapy suggest items
 *  fed through itemToPub below. */
interface BackendPubsNearResponse {
  items?: MapyGeocodeItem[];
}

interface BackendLocationLookupResponse {
  items?: MapyGeocodeItem[];
}

const MAPY_SUGGEST_URL = 'https://api.mapy.cz/v1/suggest';
const MAPY_GEOCODE_URL = 'https://api.mapy.cz/v1/geocode';

/**
 * Try the backend pubs-near proxy. Returns the raw Mapy items on success, or
 * null on ANY failure (no backend configured, non-200 incl. 503, network error,
 * malformed JSON). Never throws except for an honoured abort, which must
 * propagate like a real cancel.
 */
async function backendSuggest(
  lat: number,
  lng: number,
  kmRadius: number,
  beerBrandKey?: string,
  signal?: AbortSignal,
): Promise<MapyGeocodeItem[] | null> {
  const endpoint = getBackendEndpoint('/v1/pubs/near');
  if (!endpoint) return null;

  const url = new URL(endpoint);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radius_km', String(kmRadius));
  if (beerBrandKey) url.searchParams.set('beer_brand', beerBrandKey);

  try {
    const resp = await fetch(url.toString(), { signal });
    if (!resp.ok) {
      console.warn(`[mapy] backend pubs/near HTTP ${resp.status}`);
      trackApiFailure('pubs_near_backend', {
        endpoint: '/v1/pubs/near',
        status: resp.status,
      });
      return null;
    }
    const data = (await resp.json()) as BackendPubsNearResponse;
    return data.items ?? [];
  } catch (err) {
    // An honoured abort must propagate so callers' cancellation works.
    if (signal?.aborted) throw err;
    console.warn('[mapy] backend pubs/near failed:', err);
    trackApiFailure('pubs_near_backend', {
      endpoint: '/v1/pubs/near',
      reason: 'exception',
      error: err,
    });
    return null;
  }
}

async function backendLocationLookup(
  path: '/v1/pubs/suggest' | '/v1/pubs/geocode',
  query: string,
  near?: { lat: number; lng: number } | null,
  signal?: AbortSignal,
): Promise<MapyGeocodeItem[] | null> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || signal?.aborted) return null;

  const url = new URL(endpoint);
  url.searchParams.set('query', query);
  if (near) {
    url.searchParams.set('lat', String(near.lat));
    url.searchParams.set('lng', String(near.lng));
  }

  try {
    const resp = await fetch(url.toString(), { signal });
    if (!resp.ok) {
      trackApiFailure(path === '/v1/pubs/suggest' ? 'pub_location_suggest_backend' : 'pub_location_geocode_backend', {
        endpoint: path,
        status: resp.status,
      });
      return null;
    }
    const data = (await resp.json()) as BackendLocationLookupResponse;
    return data.items ?? [];
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure(path === '/v1/pubs/suggest' ? 'pub_location_suggest_backend' : 'pub_location_geocode_backend', {
        endpoint: path,
        reason: 'exception',
        error: err,
      });
    }
    return null;
  }
}

function getPublicMapyApiKey(): string {
  return (process.env.EXPO_PUBLIC_MAPY_API_KEY ?? '').trim();
}

function buildDirectMapyLocationUrl(
  kind: 'suggest' | 'geocode',
  query: string,
  near?: { lat: number; lng: number } | null,
): string | null {
  const apiKey = getPublicMapyApiKey();
  if (!apiKey) return null;

  const url = new URL(kind === 'suggest' ? MAPY_SUGGEST_URL : MAPY_GEOCODE_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('lang', 'cs');
  url.searchParams.set('limit', kind === 'suggest' ? '8' : '3');
  url.searchParams.append('type', 'poi');
  if (kind === 'geocode') url.searchParams.append('type', 'regional.address');
  url.searchParams.set('locality', 'cz');
  url.searchParams.set('apikey', apiKey);
  if (near) {
    url.searchParams.set('preferNear', `${near.lng},${near.lat}`);
    url.searchParams.set('preferNearPrecision', '2500');
  }
  return url.toString();
}

async function directMapyLocationLookup(
  kind: 'suggest' | 'geocode',
  query: string,
  near?: { lat: number; lng: number } | null,
  signal?: AbortSignal,
): Promise<MapyGeocodeItem[] | null> {
  if (signal?.aborted) return null;

  const url = buildDirectMapyLocationUrl(kind, query, near);
  if (!url) return null;

  try {
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      trackApiFailure(kind === 'suggest' ? 'pub_location_suggest_mapy' : 'pub_location_geocode_mapy', {
        endpoint: kind === 'suggest' ? MAPY_SUGGEST_URL : MAPY_GEOCODE_URL,
        status: resp.status,
      });
      return null;
    }
    const data = (await resp.json()) as BackendLocationLookupResponse;
    return data.items ?? [];
  } catch (err) {
    const isAbortError = err instanceof Error && err.name === 'AbortError';
    if (!signal?.aborted && !isAbortError) {
      trackApiFailure(kind === 'suggest' ? 'pub_location_suggest_mapy' : 'pub_location_geocode_mapy', {
        endpoint: kind === 'suggest' ? MAPY_SUGGEST_URL : MAPY_GEOCODE_URL,
        reason: 'exception',
        error: err,
      });
    }
    return null;
  }
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

function buildPubLocationQuery(input: PubLocationGeocodeInput): string {
  return [input.name, input.address, input.city, 'Česko']
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 150);
}

function isValidPosition(position: MapyPosition | undefined): position is MapyPosition {
  return (
    !!position &&
    Number.isFinite(position.lat) &&
    Number.isFinite(position.lon) &&
    position.lat >= -90 &&
    position.lat <= 90 &&
    position.lon >= -180 &&
    position.lon <= 180
  );
}

export async function geocodePubLocation(
  input: PubLocationGeocodeInput,
  signal?: AbortSignal,
): Promise<PubLocationGeocodeResult | null> {
  if (signal?.aborted) return null;

  const query = buildPubLocationQuery(input);
  if (!query) return null;

  const backendItems = await backendLocationLookup('/v1/pubs/geocode', query, input.near, signal);
  const items =
    backendItems ?? (await directMapyLocationLookup('geocode', query, input.near, signal));

  const item = items?.find((candidate) => isValidPosition(candidate.position));
  if (!item || !isValidPosition(item.position)) return null;
  return {
    lat: item.position.lat,
    lng: item.position.lon,
    city: pickCity(item),
    address: pickAddress(item),
    type: item.type,
  };
}

function itemToLocationSuggestion(item: MapyGeocodeItem): PubLocationSuggestion | null {
  if (!item.name || !isValidPosition(item.position)) return null;

  const city = pickCity(item);
  const address = pickAddress(item);
  const key = `${item.position.lat.toFixed(5)},${item.position.lon.toFixed(5)}`;
  return {
    id: `mapy:${key}:${item.name.trim()}`,
    name: item.name.trim(),
    lat: item.position.lat,
    lng: item.position.lon,
    city,
    address,
    location: address || city ? [address, city].filter(Boolean).join(', ') : item.location,
  };
}

export async function suggestPubLocations(
  input: PubLocationGeocodeInput,
  signal?: AbortSignal,
): Promise<PubLocationSuggestion[]> {
  if (signal?.aborted) return [];

  const query = input.name.trim().slice(0, 150);
  if (query.length < 2) return [];

  const backendItems = await backendLocationLookup('/v1/pubs/suggest', query, input.near, signal);
  const items =
    backendItems ?? (await directMapyLocationLookup('suggest', query, input.near, signal));
  if (items === null) return [];

  const seen = new Set<string>();
  const suggestions: PubLocationSuggestion[] = [];
  for (const item of items) {
    const suggestion = itemToLocationSuggestion(item);
    if (!suggestion || seen.has(suggestion.id)) continue;
    seen.add(suggestion.id);
    suggestions.push(suggestion);
  }
  return suggestions;
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

/**
 * Normalize a string for keyword matching: lowercase + strip diacritics (NFD,
 * drop combining marks). So "Kávárna" → "kavarna", "Šenk" → "senk". Used for
 * both the POI name and the keyword lists so they compare on equal footing.
 */
function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Split a normalized name into word tokens. Punctuation and symbols (e.g. the
 * "•" in "Kafe•Akropolis") count as separators, so "kafe•akropolis" yields
 * ["kafe", "akropolis"] and a keyword like "kafe" still matches.
 */
function tokenizeName(normalizedName: string): string[] {
  return normalizedName.split(/[^a-z0-9]+/i).filter(Boolean);
}

/**
 * Whole-word PREFIX match against the tokens of a name. A keyword matches when
 * some token starts with it — so "pivo" matches the token "pivovar" (desired),
 * "kava" matches "kavarna", but neither fires on an unrelated word that merely
 * contains the letters mid-string. The prefix (not bare-equality) rule is what
 * lets a single "pivo"/"pivni" entry absorb the whole beer family while keeping
 * short keywords like "kava" from leaking into unrelated names.
 */
function nameMatchesKeyword(tokens: string[], keyword: string): boolean {
  return tokens.some((token) => token.startsWith(keyword));
}

function nameIsBlocked(name: string): boolean {
  const normalized = normalizeForMatch(name);
  return NAME_BLOCKLIST.some((needle) => normalized.includes(needle));
}

/**
 * Decide whether a POI name survives the keyword heuristic for a given label.
 *
 * Decision order:
 *   1. Hard blocklist (chains) is handled by the caller before this — always out.
 *   2. A positive beer keyword in the name → always IN (overrides everything).
 *   3. Trusted pub labels (Hospoda/Pivnice/Pivovar) → IN without negative check.
 *   4. Screened labels (Restaurace a pohostinství / Bar / Klub): OUT if a
 *      negative keyword is present, otherwise IN.
 */
function passesNameHeuristic(name: string, label: string): boolean {
  const tokens = tokenizeName(normalizeForMatch(name));

  // Positive keyword wins outright, for every label.
  if (POSITIVE_NAME_KEYWORDS.some((kw) => nameMatchesKeyword(tokens, kw))) {
    return true;
  }

  // Curated pub categories are trusted as-is — no negative screening.
  if (TRUSTED_PUB_LABELS.has(label)) {
    return true;
  }

  // Broad/ambiguous categories: drop the place if it reads like a non-pub.
  if (NEGATIVE_NAME_KEYWORDS.some((kw) => nameMatchesKeyword(tokens, kw))) {
    return false;
  }
  if (NEGATIVE_NAME_KEYWORDS_EXACT.some((kw) => tokens.includes(kw))) {
    return false;
  }

  return true;
}

/**
 * Full name+label classifier used by itemToPub. Exposed for unit tests so the
 * keyword table can be exercised without constructing Mapy.cz item fixtures.
 */
export function isAcceptablePubName(name: string, label: string): boolean {
  if (nameIsBlocked(name)) return false;
  return passesNameHeuristic(name, label);
}

function itemToPub(
  item: MapyGeocodeItem,
  lat: number,
  lng: number,
  kmRadius: number,
  seen: Set<string>,
): Pub | null {
  if (!item.label || !ALLOWED_LABELS.has(item.label)) return null;
  if (!item.name || !item.position) return null;
  if (!isAcceptablePubName(item.name, item.label)) return null;

  const distance = haversineKm(lat, lng, item.position.lat, item.position.lon);
  if (distance > kmRadius) return null;

  const key = `${item.position.lat.toFixed(5)},${item.position.lon.toFixed(5)}`;
  if (seen.has(key)) return null;
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

  return pub;
}

/** Run a list of raw Mapy items through the filtering pipeline. Shared by the
 *  backend-proxied path and the direct Mapy path so both apply the identical
 *  label allow-list, name heuristics, radius clamp and dedupe. */
function itemsToPubs(
  items: MapyGeocodeItem[],
  lat: number,
  lng: number,
  kmRadius: number,
): Pub[] {
  const seen = new Set<string>();
  const pubs: Pub[] = [];
  for (const item of items) {
    const pub = itemToPub(item, lat, lng, kmRadius, seen);
    if (pub) pubs.push(pub);
  }
  return pubs;
}

/**
 * Fetch pubs near the given coordinate through our backend proxy. Throws when
 * the backend is not configured or unavailable; production builds must not fall
 * back to direct Mapy.cz nearby lookup with a bundled public API key.
 */
export async function searchPubsNear(
  lat: number,
  lng: number,
  kmRadius = 25,
  signal?: AbortSignal,
  options: { beerBrandKey?: string } = {},
): Promise<Pub[]> {
  const backendItems = await backendSuggest(lat, lng, kmRadius, options.beerBrandKey, signal);
  if (backendItems !== null) {
    return itemsToPubs(backendItems, lat, lng, kmRadius);
  }

  throw new Error('Mapy backend proxy is not configured or unavailable');
}
