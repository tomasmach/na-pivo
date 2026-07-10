import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WireVisit } from './visitsClient';

export const VISITS_MAP_SNAPSHOT_KEY = 'na-pivo-visits-map-snapshot';

let boundaryGeneration = 0;
const boundaryListeners = new Set<() => void>();

function isWireVisit(value: unknown): value is WireVisit {
  if (!value || typeof value !== 'object') return false;
  const visit = value as Partial<WireVisit>;
  return (
    typeof visit.client_id === 'string' &&
    typeof visit.cache_key === 'string' &&
    typeof visit.name === 'string' &&
    typeof visit.lat === 'number' &&
    Number.isFinite(visit.lat) &&
    typeof visit.lng === 'number' &&
    Number.isFinite(visit.lng) &&
    typeof visit.started_at === 'string'
  );
}

export function visitsSnapshotGeneration(): number {
  return boundaryGeneration;
}

export function subscribeVisitsBoundary(listener: () => void): () => void {
  boundaryListeners.add(listener);
  return () => boundaryListeners.delete(listener);
}

export async function loadVisitsSnapshot(): Promise<WireVisit[]> {
  try {
    const raw = await AsyncStorage.getItem(VISITS_MAP_SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { visits?: WireVisit[] };
    return Array.isArray(parsed.visits) ? parsed.visits.filter(isWireVisit) : [];
  } catch {
    return [];
  }
}

export async function saveVisitsSnapshot(
  visits: WireVisit[],
  generation: number,
): Promise<void> {
  if (generation !== boundaryGeneration) return;
  try {
    await AsyncStorage.setItem(
      VISITS_MAP_SNAPSHOT_KEY,
      JSON.stringify({ savedAt: Date.now(), visits }),
    );
    if (generation !== boundaryGeneration) {
      await AsyncStorage.removeItem(VISITS_MAP_SNAPSHOT_KEY);
    }
  } catch {
    // Private offline cache is best-effort; local tally still remains available.
  }
}

export async function clearVisitsSnapshot(): Promise<void> {
  boundaryGeneration += 1;
  for (const listener of boundaryListeners) listener();
  try {
    await AsyncStorage.removeItem(VISITS_MAP_SNAPSHOT_KEY);
  } catch {
    // The generation guard still prevents stale in-flight writes.
  }
}
