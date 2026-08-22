import AsyncStorage from '@/data/privateAccountStorage';

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

/** Keep the last feed useful across the additive 3.0 story contract rollout. */
function normalizeCachedNight(night: PublishedNight): PublishedNight {
  return {
    ...night,
    title: typeof night.title === 'string' ? night.title : '',
    roastLine: typeof night.roastLine === 'string' ? night.roastLine : '',
    roastBasis: typeof night.roastBasis === 'string' ? night.roastBasis : '',
    participants: Array.isArray(night.participants) ? night.participants.filter(isAuthor) : [],
    heroPhotos: Array.isArray(night.heroPhotos)
      ? night.heroPhotos.filter(
          (photo) =>
            !!photo &&
            typeof photo.id === 'string' &&
            typeof photo.imageUrl === 'string' &&
            typeof photo.caption === 'string',
        )
      : [],
    heroGames: Array.isArray(night.heroGames)
      ? night.heroGames.filter(
          (game) =>
            !!game &&
            typeof game.id === 'string' &&
            typeof game.catalogKey === 'string' &&
            typeof game.name === 'string' &&
            (game.scoring === 'points' || game.scoring === 'drinks'),
        )
      : [],
    commentCount:
      typeof night.commentCount === 'number' && Number.isFinite(night.commentCount)
        ? Math.max(0, night.commentCount)
        : 0,
  };
}

export function parseNightFeedCache(value: unknown): NightFeedCache | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<StoredNightFeed>;
  if (stored.version !== CACHE_VERSION || !Array.isArray(stored.nights)) return null;
  if (typeof stored.savedAt !== 'number' || !Number.isFinite(stored.savedAt)) return null;
  if (stored.nextCursor !== null && typeof stored.nextCursor !== 'string') return null;

  return {
    nights: stored.nights
      .filter(isPublishedNight)
      .map(normalizeCachedNight)
      .slice(0, MAX_CACHED_NIGHTS),
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

/**
 * Remove a newly blocked account everywhere it can appear in the active
 * viewer's cached feed: its own stories disappear and participant copies are
 * stripped from other people's stories. Keeping this viewer-scoped avoids
 * leaking one account's safety choices into another account that may later
 * sign in on the device.
 */
export async function removeAccountFromNightFeedCaches(
  accountId: string,
  targetAccountId: string,
): Promise<void> {
  if (!accountId || !targetAccountId) return;

  await Promise.all(
    (['friends', 'global', 'mine'] as const).map(async (scope) => {
      const cached = await loadNightFeedCache(accountId, scope);
      if (!cached) return;
      const nights = cached.nights.flatMap((night) => {
        if (night.author.id === targetAccountId) return [];
        const participants = night.participants.filter(
          (person) => person.id !== targetAccountId,
        );
        return participants.length === night.participants.length
          ? [night]
          : [{ ...night, participants }];
      });
      const changed =
        nights.length !== cached.nights.length ||
        nights.some((night, index) => night !== cached.nights[index]);
      if (!changed) return;
      await saveNightFeedCache(accountId, scope, { ...cached, nights });
    }),
  );
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
