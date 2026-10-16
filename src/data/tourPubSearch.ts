import AsyncStorage from '@react-native-async-storage/async-storage';
import { chainAbortSignal } from './apiFetch';
import { geohash8 } from './geohash';
import { usePubStore } from '@/stores/pubStore';
import { getBackendEndpoint } from './backendConfig';
import { geocodePubLocation } from './mapyClient';
import { getAllLoadedPubs, hydratePubsSnapshot, type Pub } from './pubs';

const CACHE_KEY = 'tour-pub-search-v1';
const CACHE_LIMIT = 200;
type Center = { latitude: number; longitude: number };
export type TourPubSearchResult = { pubs: Pub[]; status: 'ok' | 'cached' | 'error' | 'cancelled'; center?: Center };
function uniquePubs(pubs: readonly Pub[]): Pub[] {
  const seen = new Map<string, Pub>();
  for (const pub of pubs) if (!seen.has(pub.id)) seen.set(pub.id, pub);
  return [...seen.values()];
}
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function validPub(value: unknown): value is Pub {
  if (!value || typeof value !== 'object') return false;
  const pub = value as Pub;
  return (pub.address == null || typeof pub.address === 'string') && (pub.city == null || typeof pub.city === 'string') && typeof pub.id === 'string' && !!pub.id && typeof pub.name === 'string' && !!pub.name &&
    Number.isFinite(pub.lat) && Math.abs(pub.lat) <= 90 && Number.isFinite(pub.lng) && Math.abs(pub.lng) <= 180;
}

/** Match the map's personal exclusions, including places returned under a new ID. */
export function filterTourPubs(pubs: readonly Pub[], exclusions: { reportedPubIds: readonly string[]; reportedCacheKeys: readonly string[] } = usePubStore.getState()): Pub[] {
  const ids = new Set(exclusions.reportedPubIds);
  const cells = new Set(exclusions.reportedCacheKeys);
  // A retained tour stop can lack venue metadata; the newer catalogue verdict wins.
  for (const pub of [...pubs, ...getAllLoadedPubs()]) if (pub.venueKind === 'not_pub') ids.add(pub.id);
  return pubs.filter((pub) => pub.venueKind !== 'not_pub' && !ids.has(pub.id) && !cells.has(geohash8(pub.lat, pub.lng)));
}

async function readCachedPubs(): Promise<Pub[]> {
  try {
    const raw: unknown = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? '[]');
    return Array.isArray(raw) ? raw.filter(validPub) : [];
  } catch { return []; }
}

/** A public-place cache only; never includes account state or user location. */
export async function cachedTourPubs(query = '', known: readonly Pub[] = []): Promise<Pub[]> {
  const saved = await readCachedPubs();
  await hydratePubsSnapshot().catch(() => false);
  const all = [...known, ...getAllLoadedPubs(), ...saved];
  const unique = uniquePubs(filterTourPubs(all.filter(validPub)));
  const terms = normalize(query).replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  return unique.filter((pub) => {
    const text = normalize(`${pub.name} ${pub.address ?? ''} ${pub.city ?? ''}`);
    return terms.every((term) => text.includes(term));
  });
}

async function remember(pubs: Pub[]): Promise<void> {
  // Keep negative venue verdicts even though they are excluded from search results.
  const prior = await readCachedPubs();
  const unique = uniquePubs([...pubs, ...prior]).slice(0, CACHE_LIMIT);
  const snapshots = unique.map(({ id, name, lat, lng, address, city, venueKind }) => ({ id, name, lat, lng, address, city, venueKind }));
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(snapshots)).catch(() => {});
}

export async function searchTourPubs({ query, center, area = false, signal, known = [] }: {
  query: string; center: Center; area?: boolean; signal?: AbortSignal; known?: readonly Pub[];
}): Promise<TourPubSearchResult> {
  const cached = await cachedTourPubs(area ? '' : query, known);
  if (signal?.aborted) return { pubs: [], status: 'cancelled' };
  const abort = chainAbortSignal(signal, 10000);
  try {
    const endpoint = getBackendEndpoint('/v1/pubs/search');
    if (!endpoint) return { pubs: filterTourPubs(cached), status: 'cached' };
    async function lookup(q: string, at: Center): Promise<Pub[] | null> {
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(q)}${q ? '' : `&lat=${at.latitude}&lon=${at.longitude}&radius_km=5`}`, { signal: abort.signal });
      if (!response.ok) return null;
      const body = await response.json() as { items?: unknown[] };
      return (body.items ?? []).flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Record<string, unknown>;
        const pub = { ...item, lng: item.lon ?? item.lng };
        return validPub(pub) ? [pub] : [];
      });
    }
    let pubs = await lookup(area ? '' : query.trim(), center);
    if (pubs === null) return { pubs: filterTourPubs(cached), status: 'error' };
    let resolvedCenter: Center | undefined;
    if (!area && query.trim().length >= 2) {
      if (!pubs.length) {
        const city = await geocodePubLocation({ name: query.trim() }, abort.signal);
        if (city && (city.type === 'regional.municipality' || city.type === 'regional.municipality_part')) {
          resolvedCenter = { latitude: city.lat, longitude: city.lng };
          const nearby = await lookup('', resolvedCenter);
          if (nearby === null) return { pubs: filterTourPubs(cached), status: 'error' };
          pubs = nearby;
        }
      } else {
        const firstVisible = filterTourPubs(pubs)[0];
        if (firstVisible) resolvedCenter = { latitude: firstVisible.lat, longitude: firstVisible.lng };
      }
    }
    if (signal?.aborted) return { pubs: [], status: 'cancelled' };
    if (abort.signal.aborted) return { pubs: filterTourPubs(cached), status: 'cached' };
    await remember(pubs);
    const visible = filterTourPubs(pubs);
    return { pubs: visible, status: 'ok', center: visible.length ? resolvedCenter : undefined };
  } catch {
    if (signal?.aborted) return { pubs: [], status: 'cancelled' };
    return { pubs: filterTourPubs(cached), status: 'cached' };
  } finally { abort.cleanup(); }
}
