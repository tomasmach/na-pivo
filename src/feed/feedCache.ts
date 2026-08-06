import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NightsFeedScope, PublishedNight } from '@/data/nightsClient';

const CACHE_PREFIX = 'na-pivo-night-feed-v1:';
const CACHE_VERSION = 1;
const MAX_CACHED_NIGHTS = 100;

export interface NightFeedCache {
  nights: PublishedNight[];
  nextCursor: string | null;
  savedAt: number;
}

interface StoredNightFeed extends NightFeedCache {
  version: number;
}

export type NightFeedCacheScope = NightsFeedScope | 'mine';

function cacheKey(accountId: string, scope: NightFeedCacheScope): string {
  return `${CACHE_PREFIX}${accountId}:${scope}`;
}

function isAuthor(value: unknown): value is PublishedNight['author'] {
  if (!value || typeof value !== 'object') return false;
  const author = value as Partial<PublishedNight['author']>;
  return (
    typeof author.id === 'string' &&
    (author.nickname === null || typeof author.nickname === 'string') &&
    typeof author.displayName === 'string' &&
    (author.avatarUrl === null || typeof author.avatarUrl === 'string') &&
    typeof author.isPublic === 'boolean'
  );
}

function isPublishedNight(value: unknown): value is PublishedNight {
  if (!value || typeof value !== 'object') return false;
  const night = value as Partial<PublishedNight>;
  return (
    typeof night.id === 'string' &&
    night.id.length > 0 &&
    isAuthor(night.author) &&
    typeof night.drinkingDay === 'string' &&
    typeof night.startedAt === 'string' &&
    typeof night.endedAt === 'string' &&
    typeof night.beerCount === 'number' &&
    typeof night.wineCount === 'number' &&
    typeof night.softDrinkCount === 'number' &&
    typeof night.shotCount === 'number' &&
    Array.isArray(night.pubNames) &&
    night.pubNames.every((name) => typeof name === 'string') &&
    typeof night.city === 'string' &&
    (night.durationMinutes === null || typeof night.durationMinutes === 'number') &&
    (night.visibility === 'friends' || night.visibility === 'public') &&
    typeof night.createdAt === 'string' &&
    typeof night.rounds === 'number' &&
    typeof night.myRound === 'boolean' &&
    typeof night.isMine === 'boolean'
  );
}

export function parseNightFeedCache(value: unknown): NightFeedCache | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<StoredNightFeed>;
  if (stored.version !== CACHE_VERSION || !Array.isArray(stored.nights)) return null;
  if (typeof stored.savedAt !== 'number' || !Number.isFinite(stored.savedAt)) return null;
  if (stored.nextCursor !== null && typeof stored.nextCursor !== 'string') return null;

  return {
    nights: stored.nights.filter(isPublishedNight).slice(0, MAX_CACHED_NIGHTS),
    nextCursor: stored.nextCursor,
    savedAt: stored.savedAt,
  };
}

export async function loadNightFeedCache(
  accountId: string,
  scope: NightFeedCacheScope,
): Promise<NightFeedCache | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(accountId, scope));
    if (!raw) return null;
    return parseNightFeedCache(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveNightFeedCache(
  accountId: string,
  scope: NightFeedCacheScope,
  snapshot: NightFeedCache,
): Promise<void> {
  const stored: StoredNightFeed = {
    version: CACHE_VERSION,
    nights: snapshot.nights.slice(0, MAX_CACHED_NIGHTS),
    nextCursor: snapshot.nextCursor,
    savedAt: snapshot.savedAt,
  };
  try {
    await AsyncStorage.setItem(cacheKey(accountId, scope), JSON.stringify(stored));
  } catch {
    // A cache is an offline enhancement; persistence failure must not break the feed.
  }
}

export async function clearNightFeedCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const feedKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX));
    if (feedKeys.length > 0) await AsyncStorage.multiRemove(feedKeys);
  } catch {
    // Logout continues even if AsyncStorage is temporarily unavailable.
  }
}
