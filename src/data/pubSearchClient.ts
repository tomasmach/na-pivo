import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import { getAllLoadedPubs, hydratePubsSnapshot, type Pub } from './pubs';

const MAX_RESULTS = 20;
const REQUEST_TIMEOUT_MS = 8_000;

export type PubSearchResult = {
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  address?: string;
  city?: string;
  location?: string;
  providerPlaceId?: string;
  /** Present for catalogue results so resolving keeps hours, beers and other data. */
  pub?: Pub;
};

export type PubSearchResponse = {
  pubs: PubSearchResult[];
  failed: boolean;
};

type WireSearchItem = {
  id?: unknown;
  name?: unknown;
  providerPlaceId?: unknown;
  location?: unknown;
  address?: unknown;
  city?: unknown;
  position?: { lat?: unknown; lon?: unknown };
  regionalStructure?: { name?: unknown; type?: unknown }[];
};

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/,/g, ' ');
}

function coordinates(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lng !== 'number' ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

function validCoordinates(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function resultFromPub(pub: Pub): PubSearchResult {
  return {
    id: pub.id,
    name: pub.name,
    lat: pub.lat,
    lng: pub.lng,
    address: pub.address,
    city: pub.city,
    location: [pub.address, pub.city].filter(Boolean).join(', ') || undefined,
    providerPlaceId: pub.googlePlaceId,
    pub,
  };
}

function resultFromWire(
  value: unknown,
  fallback?: Pick<PubSearchResult, 'id' | 'name' | 'providerPlaceId'>,
): PubSearchResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as WireSearchItem;
  const name = text(item.name) ?? fallback?.name;
  if (!name) return null;

  const providerPlaceId = text(item.providerPlaceId) ?? fallback?.providerPlaceId;
  const id = text(item.id) ?? fallback?.id ?? (providerPlaceId ? `google:${providerPlaceId}` : undefined);
  if (!id) return null;

  const lat = item.position?.lat;
  const lng = item.position?.lon;
  const parsedCoordinates = coordinates(lat, lng);
  if (!parsedCoordinates && !providerPlaceId) return null;
  const resolvedCoordinates = parsedCoordinates ?? {};
  const regionalStructure = Array.isArray(item.regionalStructure)
    ? item.regionalStructure
    : [];
  const city = text(item.city) ?? text(
    regionalStructure.find(
      (part) => part && typeof part === 'object' && part.type === 'regional.municipality',
    )?.name,
  );
  const address = text(item.address) ?? text(
    regionalStructure.find(
      (part) => part && typeof part === 'object' && part.type === 'regional.street',
    )?.name,
  );
  return {
    id,
    name,
    ...resolvedCoordinates,
    address,
    city,
    location: text(item.location),
    providerPlaceId,
  };
}

function coordinateKey(result: PubSearchResult): string | null {
  const value = coordinates(result.lat, result.lng);
  return value ? `${value.lat.toFixed(5)},${value.lng.toFixed(5)}` : null;
}

function mergeResults(local: PubSearchResult[], remote: PubSearchResult[]): PubSearchResult[] {
  const merged: PubSearchResult[] = [];
  const ids = new Set<string>();
  const coordinates = new Set<string>();

  for (const result of [...local, ...remote]) {
    const key = coordinateKey(result);
    if (ids.has(result.id) || (key !== null && coordinates.has(key))) continue;
    ids.add(result.id);
    if (key !== null) coordinates.add(key);
    merged.push(result);
    if (merged.length === MAX_RESULTS) break;
  }
  return merged;
}

export function localPubSearch(query: string): PubSearchResult[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.join('').length < 2) return [];

  return getAllLoadedPubs()
    .filter((pub) => {
      if (pub.venueKind === 'not_pub') return false;
      const haystack = normalize([pub.name, pub.city, pub.address].filter(Boolean).join(' '));
      return terms.every((term) => haystack.includes(term));
    })
    .slice(0, MAX_RESULTS)
    .map(resultFromPub);
}

async function postItems(
  path: '/v1/pubs/suggest' | '/v1/pubs/geocode',
  body: Record<string, string | boolean>,
  signal?: AbortSignal,
): Promise<{ items: WireSearchItem[]; failed: boolean }> {
  const endpoint = getBackendEndpoint(path);
  if (!endpoint || signal?.aborted) return { items: [], failed: true };

  const abort = chainAbortSignal(signal, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    if (!response.ok) return { items: [], failed: true };
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) {
      return { items: [], failed: true };
    }
    return {
      items: (payload as { items: WireSearchItem[] }).items,
      failed: false,
    };
  } catch {
    return { items: [], failed: true };
  } finally {
    abort.cleanup();
  }
}

export async function searchPubNames(
  query: string,
  signal?: AbortSignal,
): Promise<PubSearchResponse> {
  const trimmed = query.trim().slice(0, 150);
  if (trimmed.length < 2) return { pubs: [], failed: false };

  try {
    await hydratePubsSnapshot();
  } catch {
    // The in-memory catalogue remains useful when persisted storage is malformed.
  }
  const local = localPubSearch(trimmed);
  const response = await postItems('/v1/pubs/suggest', { query: trimmed, pub_search: true }, signal);
  const remote = response.items
    .map((item) => resultFromWire(item))
    .filter((item): item is PubSearchResult => item !== null);
  return { pubs: mergeResults(local, remote), failed: response.failed };
}

export async function resolvePubSearchResult(
  result: PubSearchResult,
  signal?: AbortSignal,
): Promise<Pub | null> {
  if (signal?.aborted) return null;
  if (result.pub) return result.pub;
  const existingCoordinates = coordinates(result.lat, result.lng);
  if (existingCoordinates) {
    return {
      id: result.id,
      name: result.name,
      lat: existingCoordinates.lat,
      lng: existingCoordinates.lng,
      address: result.address,
      city: result.city,
      googlePlaceId: result.providerPlaceId,
    };
  }
  if (!result.providerPlaceId) return null;

  const response = await postItems(
    '/v1/pubs/geocode',
    { query: result.name, place_id: result.providerPlaceId, pub_search: true },
    signal,
  );
  if (response.failed) return null;
  const resolved = response.items
    .map((item) => resultFromWire(item, result))
    .find((item): item is PubSearchResult => item !== null && validCoordinates(item.lat, item.lng));
  const resolvedCoordinates = resolved && coordinates(resolved.lat, resolved.lng);
  if (!resolved || !resolvedCoordinates) return null;

  return {
    id: resolved.id || result.id,
    name: resolved.name || result.name,
    lat: resolvedCoordinates.lat,
    lng: resolvedCoordinates.lng,
    address: resolved.address ?? result.address ?? result.location,
    city: resolved.city ?? result.city,
    googlePlaceId: resolved.providerPlaceId ?? result.providerPlaceId,
  };
}
