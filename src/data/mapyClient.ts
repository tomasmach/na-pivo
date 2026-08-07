/**
 * Pub discovery client for the backend's provider-compatible v1 wire format.
 *
 * The filename and legacy item shape remain stable for released-client
 * compatibility, but the mobile app never calls Mapy or Google Places directly.
 * Nearby discovery is served from our local directory; explicit location
 * lookups are provider-swappable behind the backend.
 */

import type { HoursStatus, Pub, VenueKind } from './pubs';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { trackApiFailure } from './telemetryClient';
import { isPriceFresh } from '@/utils/priceAge';

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
// A Mapy `Bar` result still goes through the negative-name screen above, so a
// surviving bar is strong enough for a quiet background reminder. `Klub` and
// the generic restaurant bucket stay ambiguous without a beer signal.
const REMINDER_PUB_LABELS = new Set<string>([...TRUSTED_PUB_LABELS, 'Bar']);

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
  id?: string;
  name: string;
  label?: string;
  position: MapyPosition;
  type?: string;
  location?: string;
  zip?: string;
  regionalStructure?: { name: string; type: string }[];
  /** Additive backend classification for opt-in non-pub tap places. */
  discoveryKind?: 'pub' | 'seasonal_stand' | 'campsite' | 'sports_venue';
  /** Additive backend-only field: Google Place ID, attached by our backend's
   *  nearby endpoint when known. Never present on raw Mapy.cz responses. */
  googlePlaceId?: string | null;
  /** Additive cache-only detail attached by our backend's nearby endpoint. */
  pubDetails?: {
    opening_hours?: string | null;
    isOpenNow?: boolean | null;
    nextChange?: string | null;
    status?: string;
    source?: string | null;
    rating?: number | null;
    ratingCount?: number | null;
    ratingLabel?: string | null;
    hasGarden?: boolean | null;
    venueKind?: string | null;
    beer_menu_rotates?: boolean;
    /** Reference large-beer price; only attached when observed within a year. */
    price?: {
      czk?: number | null;
      volume_ml?: number | null;
      observed_at?: string | null;
      source?: string | null;
    } | null;
  };
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
  applied_filters?: {
    version?: number;
    match?: string;
    amenities?: string[];
    beer_brand?: string | null;
    beer_brands?: string[];
    beer_match?: string;
    include_other_places?: boolean;
  };
}

interface BackendLocationLookupResponse {
  items?: MapyGeocodeItem[];
}

/** Hard cap on a nearby-pubs request; generous enough for a slow mobile
 *  connection, short enough that a stalled socket cannot pin the map. */
const PUBS_NEAR_TIMEOUT_MS = 10_000;

/**
 * Try the backend pubs-near proxy. Returns the raw Mapy items on success, or
 * null on ANY failure (no backend configured, non-200 incl. 503, network error,
 * malformed JSON, timeout). Never throws except for an honoured caller abort,
 * which must propagate like a real cancel.
 */
async function backendSuggest(
  lat: number,
  lng: number,
  kmRadius: number,
  beerBrandKey?: string,
  beerBrandKeys: readonly string[] = [],
  amenityKeys: readonly string[] = [],
  includeOtherPlaces = false,
  signal?: AbortSignal,
): Promise<MapyGeocodeItem[] | null> {
  const endpoint = getBackendEndpoint('/v1/pubs/near');
  if (!endpoint) return null;

  const url = new URL(endpoint);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radius_km', String(kmRadius));
  if (beerBrandKeys.length > 0) {
    url.searchParams.set('beer_brands', beerBrandKeys.join(','));
  } else if (beerBrandKey) {
    url.searchParams.set('beer_brand', beerBrandKey);
  }
  if (amenityKeys.length > 0) url.searchParams.set('amenities', amenityKeys.join(','));
  if (includeOtherPlaces) url.searchParams.set('include_other_places', 'true');

  // Hard timeout: without it a stalled request on a bad connection pins the
  // map in its loading state forever — failing fast surfaces the stale banner
  // and lets the next pan retry.
  const abort = chainAbortSignal(signal, PUBS_NEAR_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), { signal: abort.signal });
    if (!resp.ok) {
      console.warn(`[pubs] backend pubs/near HTTP ${resp.status}`);
      trackApiFailure('pubs_near_backend', {
        endpoint: '/v1/pubs/near',
        status: resp.status,
      });
      return null;
    }
    const data = (await resp.json()) as BackendPubsNearResponse;
    if (beerBrandKeys.length > 0) {
      const applied = data.applied_filters;
      const acknowledgedBeerBrands = Array.isArray(applied?.beer_brands)
        ? [...applied.beer_brands].sort()
        : [];
      const requestedBeerBrands = [...beerBrandKeys].sort();
      const acknowledgedAmenities = Array.isArray(applied?.amenities)
        ? [...applied.amenities].sort()
        : [];
      const requestedAmenities = [...amenityKeys].sort();
      const acknowledged =
        applied?.version === 3 &&
        applied.match === 'all' &&
        applied.beer_match === 'any' &&
        acknowledgedBeerBrands.length === requestedBeerBrands.length &&
        acknowledgedBeerBrands.every((key, index) => key === requestedBeerBrands[index]) &&
        acknowledgedAmenities.length === requestedAmenities.length &&
        acknowledgedAmenities.every((key, index) => key === requestedAmenities[index]) &&
        (applied.include_other_places ?? false) === includeOtherPlaces;
      if (!acknowledged) {
        // Multi-select is additive. During a rolling deploy an older server may
        // ignore `beer_brands` and return an unfiltered 200; never present that
        // catalogue as if it satisfied the user's ANY-of brand choice.
        console.warn('[pubs] backend did not acknowledge multi-brand filters');
        trackApiFailure('pubs_near_backend', {
          endpoint: '/v1/pubs/near',
          reason: 'filter_contract_mismatch',
        });
        return null;
      }
    } else if (amenityKeys.length > 0) {
      const applied = data.applied_filters;
      const acknowledgedAmenities = Array.isArray(applied?.amenities)
        ? [...applied.amenities].sort()
        : [];
      const requestedAmenities = [...amenityKeys].sort();
      const acknowledged =
        applied?.version === (includeOtherPlaces ? 2 : 1) &&
        applied.match === 'all' &&
        acknowledgedAmenities.length === requestedAmenities.length &&
        acknowledgedAmenities.every((key, index) => key === requestedAmenities[index]) &&
        (applied.beer_brand ?? null) === (beerBrandKey || null) &&
        (applied.include_other_places ?? false) === includeOtherPlaces;
      if (!acknowledged) {
        // A rolling deploy can briefly put a new app against an older backend
        // that ignores unknown query params. Fail closed: unfiltered pubs must
        // never masquerade as confirmed amenity matches.
        console.warn('[pubs] backend did not acknowledge amenity filters');
        trackApiFailure('pubs_near_backend', {
          endpoint: '/v1/pubs/near',
          reason: 'filter_contract_mismatch',
        });
        return null;
      }
    }
    return data.items ?? [];
  } catch (err) {
    // An honoured CALLER abort must propagate so cancellation works; an
    // internal timeout abort falls through to the null (unavailable) path.
    if (signal?.aborted) throw err;
    console.warn('[pubs] backend pubs/near failed:', err);
    trackApiFailure('pubs_near_backend', {
      endpoint: '/v1/pubs/near',
      reason: 'exception',
      error: err,
    });
    return null;
  } finally {
    abort.cleanup();
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

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        ...(near ? { lat: near.lat, lng: near.lng } : {}),
      }),
      signal,
    });
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
  // No hardcoded country — the app serves CZ + SK, and locality=cz,sk already
  // scopes the search. Appending "Česko" mislocated Slovak pubs (PIV-21).
  return [input.name, input.address, input.city]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 150);
}

function buildAddressLocationQuery(input: PubLocationGeocodeInput): string {
  return [input.address, input.city]
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

function isSpecificGeocodeItem(item: MapyGeocodeItem): boolean {
  return !!item.type && SPECIFIC_GEOCODE_TYPES.has(item.type);
}

function geocodeResultFromItem(item: MapyGeocodeItem): PubLocationGeocodeResult {
  return {
    lat: item.position.lat,
    lng: item.position.lon,
    city: pickCity(item),
    address: pickAddress(item),
    type: item.type,
  };
}

async function lookupGeocodeItems(
  query: string,
  near?: { lat: number; lng: number } | null,
  signal?: AbortSignal,
): Promise<MapyGeocodeItem[] | null> {
  return backendLocationLookup('/v1/pubs/geocode', query, near, signal);
}

export async function geocodePubLocation(
  input: PubLocationGeocodeInput,
  signal?: AbortSignal,
): Promise<PubLocationGeocodeResult | null> {
  if (signal?.aborted) return null;

  const primaryQuery = buildPubLocationQuery(input);
  if (!primaryQuery) return null;

  const queries = [primaryQuery];
  const addressQuery = buildAddressLocationQuery(input);
  if (addressQuery && addressQuery !== primaryQuery) {
    queries.push(addressQuery);
  }

  let firstValid: MapyGeocodeItem | null = null;
  for (const query of queries) {
    const items = await lookupGeocodeItems(query, input.near, signal);
    if (items === null) continue;

    for (const item of items) {
      if (!isValidPosition(item.position)) continue;
      if (!firstValid) firstValid = item;
      if (isSpecificGeocodeItem(item)) return geocodeResultFromItem(item);
    }
  }

  return firstValid ? geocodeResultFromItem(firstValid) : null;
}

function itemToLocationSuggestion(item: MapyGeocodeItem): PubLocationSuggestion | null {
  if (!item.name || !isValidPosition(item.position)) return null;

  const city = pickCity(item);
  const address = pickAddress(item);
  const key = `${item.position.lat.toFixed(5)},${item.position.lon.toFixed(5)}`;
  return {
    id: item.id?.trim() || `mapy:${key}:${item.name.trim()}`,
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

  const items = await backendLocationLookup('/v1/pubs/suggest', query, input.near, signal);
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
 * Strong enough evidence to treat a Mapy result as a pub without waiting for
 * backend enrichment. Screened bars are accepted; generic restaurants and
 * clubs deliberately stay `maybe` until community beer data confirms them.
 */
function hasStrongPubSignal(name: string, label: string): boolean {
  if (REMINDER_PUB_LABELS.has(label)) return true;
  const tokens = tokenizeName(normalizeForMatch(name));
  return POSITIVE_NAME_KEYWORDS.some((keyword) => nameMatchesKeyword(tokens, keyword));
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
    // Persist the discovery confidence with the nearby snapshot. Reminder
    // geofences can then fail closed offline instead of treating every broad
    // restaurant result as a confirmed pub.
    venueKind: hasStrongPubSignal(item.name, item.label) ? 'pub' : 'maybe',
    discoveryKind: item.discoveryKind ?? 'pub',
  };
  const address = pickAddress(item);
  if (address) pub.address = address;
  const city = pickCity(item);
  if (city) pub.city = city;
  if (typeof item.googlePlaceId === 'string' && item.googlePlaceId.length > 0) {
    pub.googlePlaceId = item.googlePlaceId;
  }

  const details = item.pubDetails;
  if (details) {
    pub.openingHours = details.opening_hours ?? null;
    pub.isOpenNow = typeof details.isOpenNow === 'boolean' ? details.isOpenNow : null;
    pub.nextChange = typeof details.nextChange === 'string' ? details.nextChange : null;
    if (['ok', 'unknown', 'pending', 'error'].includes(details.status ?? '')) {
      pub.hoursStatus = details.status as HoursStatus;
    }
    if (typeof details.source === 'string') pub.hoursSource = details.source;
    pub.rating = typeof details.rating === 'number' && Number.isFinite(details.rating)
      ? details.rating
      : null;
    pub.ratingCount =
      typeof details.ratingCount === 'number' && Number.isFinite(details.ratingCount)
        ? details.ratingCount
        : null;
    pub.ratingLabel = typeof details.ratingLabel === 'string' ? details.ratingLabel : null;
    pub.hasGarden = typeof details.hasGarden === 'boolean' ? details.hasGarden : null;
    if (['pub', 'maybe', 'not_pub', 'unknown'].includes(details.venueKind ?? '')) {
      pub.venueKind = details.venueKind as VenueKind;
    }
    pub.beerMenuRotates = details.beer_menu_rotates === true;
    const price = details.price;
    pub.price =
      price &&
      typeof price.czk === 'number' &&
      Number.isFinite(price.czk) &&
      price.czk >= 1 &&
      price.czk <= 1000 &&
      typeof price.observed_at === 'string' &&
      isPriceFresh(price.observed_at)
        ? {
            czk: Math.round(price.czk),
            volumeMl:
              typeof price.volume_ml === 'number' && Number.isFinite(price.volume_ml)
                ? price.volume_ml
                : null,
            observedAt: price.observed_at,
            source: typeof price.source === 'string' ? price.source : 'community',
          }
        : null;
  }

  return pub;
}

/** Run provider-shaped backend items through the filtering pipeline. */
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
  options: {
    beerBrandKey?: string;
    beerBrandKeys?: readonly string[];
    amenityKeys?: readonly string[];
    includeOtherPlaces?: boolean;
  } = {},
): Promise<Pub[]> {
  const beerBrandKeys = Array.from(
    new Set((options.beerBrandKeys ?? []).map((key) => key.trim()).filter(Boolean)),
  ).sort();
  const backendItems = await backendSuggest(
    lat,
    lng,
    kmRadius,
    options.beerBrandKey,
    beerBrandKeys,
    options.amenityKeys,
    options.includeOtherPlaces,
    signal,
  );
  if (backendItems !== null) {
    return itemsToPubs(backendItems, lat, lng, kmRadius);
  }

  throw new Error('Pub directory backend is not configured or unavailable');
}
