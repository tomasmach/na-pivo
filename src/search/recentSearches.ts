import AsyncStorage from '@react-native-async-storage/async-storage';

// Already removed by privateAccountData on sign-out/account deletion.
const STORAGE_KEY = 'na-pivo-search-recent-v1';
const MAX_RECENT = 8;

export function mergeRecentSearches(current: readonly string[], query: string): string[] {
  const clean = query.trim().slice(0, 80);
  if (!clean) return current.slice(0, MAX_RECENT);
  return [clean, ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT);
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string' && !!item.trim())
      .slice(0, MAX_RECENT).map((item) => item.trim().slice(0, 80));
  } catch { return []; }
}

export async function saveRecentSearch(current: readonly string[], query: string): Promise<void> {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(mergeRecentSearches(current, query))); }
  catch { /* History must never block opening a pub. */ }
}
