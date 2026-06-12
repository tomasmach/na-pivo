/**
 * Mapy.cz REST API client — POI search for pubs/bars.
 *
 * Strategy: prefer our own backend (which proxies Mapy.cz and caches results,
 * so it spends our shared Mapy credit instead of every client doing 4+ requests
 * each). When the backend is unset, errors, or returns 503 (no key / cap
 * exhausted), fall back to hitting Mapy.cz /v1/suggest directly: 4 parallel
 * queries (hospoda, bar, pivnice, pivovar) with a tight bbox around the user.
 * Suggest ranks by location, unlike geocode which biases toward textual
 * relevance. Either way the raw Mapy items run through the SAME pipeline:
 * deduplicated, label-filtered, name-blocklisted, and clamped to the radius.
 */

import type { Pub } from './pubs';
import { getBackendEndpoint } from './backendConfig';

// /v1/suggest is dramatically better than /v1/geocode for "POIs near me" —
// it ranks by location rather than textual relevance, so a small bbox around
// the user reliably surfaces local results instead of pushing back popular
// places from far away.
const BASE_URL = 'https://api.mapy.cz/v1/suggest';
const USER_AGENT = 'napivo-ios/1.0';

const QUERY_TERMS = ['hospoda', 'bar', 'pivnice', 'pivovar'];
const MAX_RESULTS_PER_QUERY = 15; // Mapy.cz API limit.
const SUGGEST_BBOX_STEPS_KM = [5, 15, 50, 100] as const;

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
  location?: string;
  zip?: string;
  regionalStructure?: { name: string; type: string }[];
}

interface MapyGeocodeResponse {
  items?: MapyGeocodeItem[];
}

// Read at module top-level so Metro inlines the value at bundle time.
const MAPY_API_KEY = process.env.EXPO_PUBLIC_MAPY_API_KEY ?? '';

function getApiKey(): string {
  return MAPY_API_KEY;
}

/** Shape of the backend's pubs-near response. items are RAW Mapy suggest items
 *  (same shape as a direct /v1/suggest response), fed through itemToPub below. */
interface BackendPubsNearResponse {
  items?: MapyGeocodeItem[];
}

/**
 * Try the backend pubs-near proxy. Returns the raw Mapy items on success, or
 * null on ANY failure (no backend configured, non-200 incl. 503, network error,
 * malformed JSON) so the caller falls back to the direct Mapy.cz flow. Never
 * throws except for an honoured abort, which must propagate like a real cancel.
 */
async function backendSuggest(
  lat: number,
  lng: number,
  kmRadius: number,
  signal?: AbortSignal,
): Promise<MapyGeocodeItem[] | null> {
  const endpoint = getBackendEndpoint('/v1/pubs/near');
  if (!endpoint) return null; // No backend — use the fallback.

  const url = new URL(endpoint);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radius_km', String(kmRadius));

  try {
    const resp = await fetch(url.toString(), { signal });
    if (!resp.ok) {
      // 503 (no key / cap exhausted) or any other non-200 → fall back.
      console.warn(`[mapy] backend pubs/near HTTP ${resp.status} — falling back to Mapy`);
      return null;
    }
    const data = (await resp.json()) as BackendPubsNearResponse;
    return data.items ?? [];
  } catch (err) {
    // An honoured abort must propagate so callers' cancellation works; any other
    // failure (network, malformed JSON) just means "use the fallback".
    if (signal?.aborted) throw err;
    console.warn('[mapy] backend pubs/near failed — falling back to Mapy:', err);
    return null;
  }
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

function buildSuggestRadiusSteps(kmRadius: number): number[] {
  const steps = SUGGEST_BBOX_STEPS_KM.filter((step) => step < kmRadius);
  return [...steps, kmRadius].filter((step, index, arr) => index === 0 || step !== arr[index - 1]);
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
 * Fetch pubs near the given coordinate, preferring our backend proxy and
 * falling back to Mapy.cz directly. Throws only when BOTH the backend is
 * unavailable AND the direct path can't run (no API key) or all its requests
 * fail — so callers' error handling still fires on a true outage.
 */
export async function searchPubsNear(
  lat: number,
  lng: number,
  kmRadius = 25,
  signal?: AbortSignal,
): Promise<Pub[]> {
  // Backend-first: it caches Mapy results and spends our shared credit once,
  // instead of every client cold-starting 4+ Mapy requests of its own.
  const backendItems = await backendSuggest(lat, lng, kmRadius, signal);
  if (backendItems !== null) {
    return itemsToPubs(backendItems, lat, lng, kmRadius);
  }

  // Fallback: hit Mapy.cz directly (unchanged behavior).
  return searchPubsNearDirect(lat, lng, kmRadius, signal);
}

/**
 * Direct Mapy.cz suggest flow — the fallback when the backend is unavailable.
 * Throws if the API key is missing or all requests fail.
 */
async function searchPubsNearDirect(
  lat: number,
  lng: number,
  kmRadius: number,
  signal?: AbortSignal,
): Promise<Pub[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('MAPY_API_KEY is not configured');
  }

  const seen = new Set<string>();
  const pubs: Pub[] = [];
  let anyRequestSucceeded = false;

  // Suggest ranks by proximity and only accepts a preferred bbox, not a strict
  // radius. For unlimited / large searches, start local and progressively widen
  // the preferred area so rural users do not get an empty result just because
  // nothing matched inside the old fixed 5 km bbox.
  for (const bboxRadiusKm of buildSuggestRadiusSteps(kmRadius)) {
    const suggestBBox = buildPreferBBox(lat, lng, bboxRadiusKm);
    const settled = await Promise.allSettled(
      QUERY_TERMS.map((term) => suggestQuery(term, suggestBBox, apiKey, signal)),
    );

    const items: MapyGeocodeItem[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        anyRequestSucceeded = true;
        items.push(...result.value);
      }
    }

    for (const item of items) {
      const pub = itemToPub(item, lat, lng, kmRadius, seen);
      if (pub) pubs.push(pub);
    }

    if (pubs.length > 0) break;
  }

  if (!anyRequestSucceeded) {
    throw new Error('All Mapy.cz suggest queries failed');
  }

  return pubs;
}
