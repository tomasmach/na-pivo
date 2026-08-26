import type { PublishedNight } from '@/data/nightsClient';
import type { PartaFeedSitting } from '@/data/partaFeedClient';
import { drinkingDayKey } from '@/stores/tallyStore';

function instant(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nightKey(accountId: string, day: string): string {
  return `${accountId}:${day}`;
}

function countOf(
  sittings: readonly PartaFeedSitting[],
  type: 'beer' | 'wine' | 'soft_drink' | 'shot',
): number {
  const exactField = {
    beer: 'beerCount',
    wine: 'wineCount',
    soft_drink: 'softDrinkCount',
    shot: 'shotCount',
  }[type] as 'beerCount' | 'wineCount' | 'softDrinkCount' | 'shotCount';
  return sittings.reduce(
    (total, sitting) =>
      total +
      (typeof sitting[exactField] === 'number'
        ? sitting[exactField]
        : sitting.items.reduce(
            (subtotal, item) => subtotal + (item.drinkType === type ? item.count : 0),
            0,
          )),
    0,
  );
}

function historicalNight(
  day: string,
  sittings: readonly PartaFeedSitting[],
): PublishedNight {
  const ordered = [...sittings].sort(
    (left, right) => instant(left.startedAt) - instant(right.startedAt),
  );
  const first = ordered[0];
  const startedAtMs = Math.min(...ordered.map((sitting) => instant(sitting.startedAt)));
  const endedAtMs = Math.max(
    ...ordered.map((sitting) => instant(sitting.endedAt || sitting.startedAt)),
  );
  const pubNames = ordered
    .map((sitting) => sitting.pubName.trim())
    .filter((name, index, all) => name && all.indexOf(name) === index);
  const durationMinutes = Math.max(0, Math.round((endedAtMs - startedAtMs) / 60_000));

  return {
    id: `historical-night:${first.account.id}:${day}`,
    historical: true,
    author: first.account,
    drinkingDay: day,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    beerCount: countOf(ordered, 'beer'),
    wineCount: countOf(ordered, 'wine'),
    softDrinkCount: countOf(ordered, 'soft_drink'),
    shotCount: countOf(ordered, 'shot'),
    pubNames,
    city: ordered.find((sitting) => sitting.pubCity.trim())?.pubCity.trim() ?? '',
    durationMinutes: durationMinutes || null,
    title: '',
    roastLine: '',
    roastBasis: '',
    participants: [],
    heroPhotos: [],
    heroGames: [],
    visibility: 'friends',
    createdAt: new Date(endedAtMs).toISOString(),
    rounds: 0,
    myRound: false,
    isMine: first.mine,
    commentCount: 0,
  };
}

/**
 * Hide the evening that is still running.
 *
 * A running evening already has its place in the app: the live bar and the ring
 * around the Party tab (DESIGN §20.5). Its drinks reach the server one by one,
 * so the automatic Parta history would otherwise draw them as a finished post
 * — with a duration that grows while you sit there — before anything was
 * published.
 */
export function withoutRunningNight(
  nights: readonly PublishedNight[],
  runningDrinkingDay: string | null,
): PublishedNight[] {
  if (!runningDrinkingDay) return [...nights];
  return nights.filter(
    (night) =>
      !(night.historical && night.isMine && night.drinkingDay === runningDrinkingDay),
  );
}

/** Add automatic Parta history without duplicating an explicitly published day. */
export function mergeHistoricalNights(
  published: readonly PublishedNight[],
  sittings: readonly PartaFeedSitting[],
): PublishedNight[] {
  const publishedKeys = new Set(
    published.map((night) => nightKey(night.author.id, night.drinkingDay)),
  );
  const groups = new Map<string, { day: string; sittings: PartaFeedSitting[] }>();

  for (const sitting of sittings) {
    const endedAt = new Date(sitting.endedAt || sitting.startedAt);
    if (!sitting.account.id || Number.isNaN(endedAt.getTime())) continue;
    const day = drinkingDayKey(endedAt);
    const key = nightKey(sitting.account.id, day);
    if (publishedKeys.has(key)) continue;
    const group = groups.get(key);
    if (group) group.sittings.push(sitting);
    else groups.set(key, { day, sittings: [sitting] });
  }

  const historical = [...groups.values()].map((group) =>
    historicalNight(group.day, group.sittings),
  );
  return [...published, ...historical].sort(
    (left, right) => instant(right.createdAt) - instant(left.createdAt),
  );
}
