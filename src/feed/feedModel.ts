import type { NightPublishPayload, PublishedNight } from '@/data/nightsClient';
import type { AccountProfile } from '@/data/auth';
import { formatRelative } from '@/friends/useNowTick';

export interface FeedNightEntry {
  source: 'night';
  id: string;
  clientId?: string;
  author: {
    id: string;
    nickname: string | null;
    displayName: string;
    avatarUrl: string | null;
  };
  when: string;
  title: string;
  pubNames: string[];
  city: string;
  beerCount: number;
  wineCount: number;
  softDrinkCount: number;
  shotCount: number;
  durationMinutes: number | null;
  duration: string;
  rounds: number;
  myRound: boolean;
  isMine: boolean;
  pending: boolean;
  /** The drinking-day key the recap resolves a night by. Empty when unknown. */
  drinkingDay: string;
}

export function formatFeedDuration(minutes: number | null): string {
  if (minutes == null || minutes < 1) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function nightTitle(pubNames: string[], city: string): string {
  const place = pubNames[0]?.trim() || city.trim();
  return place ? `Večer v ${place}` : 'Večer v hospodě';
}

export function publishedNightToFeedEntry(
  night: PublishedNight,
  now: number = Date.now(),
): FeedNightEntry {
  return {
    source: 'night',
    id: night.id,
    ...(night.clientId ? { clientId: night.clientId } : {}),
    author: night.author,
    when: formatRelative(night.createdAt || night.endedAt, now),
    title: nightTitle(night.pubNames, night.city),
    pubNames: night.pubNames,
    city: night.city,
    beerCount: night.beerCount,
    wineCount: night.wineCount,
    softDrinkCount: night.softDrinkCount,
    shotCount: night.shotCount,
    durationMinutes: night.durationMinutes,
    duration: formatFeedDuration(night.durationMinutes),
    rounds: night.rounds,
    myRound: night.myRound,
    isMine: night.isMine,
    pending: false,
    drinkingDay: night.drinkingDay,
  };
}

export function pendingPublishToFeedEntry(
  payload: NightPublishPayload,
  profile: AccountProfile | null,
  now: number = Date.now(),
): FeedNightEntry {
  return {
    source: 'night',
    id: `pending:${payload.clientId}`,
    clientId: payload.clientId,
    author: {
      id: profile?.id ?? '',
      nickname: profile?.nickname ?? null,
      displayName: profile?.displayName || 'Ty',
      avatarUrl: profile?.avatarUrl ?? null,
    },
    when: formatRelative(payload.updatedAt, now) || 'čeká na signál',
    title: nightTitle(payload.pubNames, payload.city ?? ''),
    pubNames: payload.pubNames,
    city: payload.city ?? '',
    beerCount: payload.beerCount,
    wineCount: payload.wineCount,
    softDrinkCount: payload.softDrinkCount,
    shotCount: payload.shotCount,
    durationMinutes: payload.durationMinutes ?? null,
    duration: formatFeedDuration(payload.durationMinutes ?? null),
    rounds: 0,
    myRound: false,
    isMine: true,
    pending: true,
    drinkingDay: payload.drinkingDay,
  };
}

export function mergeFeedNights(
  pending: FeedNightEntry[],
  published: FeedNightEntry[],
): FeedNightEntry[] {
  const publishedClientIds = new Set(
    published.flatMap((entry) => (entry.clientId ? [entry.clientId] : [])),
  );
  return [
    ...pending.filter((entry) => !entry.clientId || !publishedClientIds.has(entry.clientId)),
    ...published,
  ];
}
