import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'na-pivo-search-recent-v1';
const MAX_RECENT = 8;

export function mergeRecentSearches(current: readonly string[], query: string): string[] {
  const clean = query.trim().slice(0, 80);
  if (!clean) return current.slice(0, MAX_RECENT);
  const key = clean.toLocaleLowerCase('cs-CZ');
  return [
    clean,
    ...current.filter((item) => item.toLocaleLowerCase('cs-CZ') !== key),
  ].slice(0, MAX_RECENT);
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export async function saveRecentSearch(current: readonly string[], query: string): Promise<string[]> {
  const next = mergeRecentSearches(current, query);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Search history is a convenience; storage failure must never block search.
  }
  return next;
}
