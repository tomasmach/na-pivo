/**
 * Z večera příspěvek — the same night, said out loud.
 *
 * Publishing a party night is not a different feature from publishing a diary
 * night: it is `POST /v1/nights`, the endpoint that already exists, already has
 * a feed, already has reactions and already has an offline queue. The hub used
 * to publish into a zustand store in memory instead, which looked identical and
 * reached nobody.
 *
 * So this is only a translation: `NightRecord` → `NightPublishPayload`. Nothing
 * new is invented on the way out, and two rules are worth stating:
 *
 *   The key is the DRINKING DAY. `night-2026-07-30`, the same key the diary
 *   uses, so a night published from the hub and the same night published from
 *   Výčep are one post that gets updated — not two posts arguing about how many
 *   beers there were.
 *
 *   What travels is COUNTS. No prices, no coordinates, no individual beer names
 *   — the shape of the endpoint says so and the product rules say so twice
 *   (`AGENTS.md`, `docs/decisions/no-bac-or-driving-estimates.md`). Pub NAMES do
 *   travel: a night is where it happened, and a pub is a public place.
 */

import { MAX_PUB_NAMES } from '@/vycep/nightModel';
import { drinkingDayKey } from '@/stores/tallyStore';
import { nightMinutes, nightTally, type NightRecord } from '@/party/nightRecord';
import type { NightPublishPayload, NightVisibility } from '@/data/nightsClient';

interface PublishableNightPhoto {
  id: string | null;
  clientId: string;
  visibility: 'private' | 'friends';
  partyCode?: string;
  partyDrinkingDay?: string;
}

/**
 * Stable photo references for the post. Client ids intentionally survive an
 * offline upload; the server resolves them when the photo eventually arrives.
 */
export function nightPhotoReferences(
  photos: readonly PublishableNightPhoto[],
  partyCode: string | undefined,
  drinkingDay: string,
): string[] {
  const normalizedCode = partyCode?.toUpperCase();
  return photos
    .filter(
      (photo) =>
        photo.visibility === 'friends' &&
        ((normalizedCode && photo.partyCode?.toUpperCase() === normalizedCode) ||
          photo.partyDrinkingDay === drinkingDay),
    )
    .map((photo) => photo.id ?? photo.clientId)
    .filter((id, index, all) => UUID_RE.test(id) && all.indexOf(id) === index)
    .slice(0, 6);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function nightPublishPayload(
  night: NightRecord,
  {
    visibility,
    now,
    city,
    ownerId,
    title,
    roastLine,
    roastBasis,
    partyCode,
    participantIds,
    photoIds,
    gameIds,
  }: {
    visibility: NightVisibility;
    /** The instant the night is being published. Passed in, so this stays pure. */
    now: number;
    city?: string;
    /** Publish only this account's diary rows, never the whole shared table. */
    ownerId?: string;
    /** Explicit presentation/snapshot selected on the finish screen. */
    title?: string;
    roastLine?: string;
    roastBasis?: string;
    partyCode?: string;
    participantIds?: string[];
    photoIds?: string[];
    gameIds?: string[];
  },
): NightPublishPayload {
  const drinks = ownerId ? night.drinks.filter((drink) => drink.by === ownerId) : night.drinks;
  const referencedStops = new Set(drinks.flatMap((drink) => (drink.stopId ? [drink.stopId] : [])));
  const stops = ownerId
    ? night.stops.filter(
        (stop) => stop.by === ownerId || referencedStops.has(stop.id),
      )
    : night.stops;
  const owner = ownerId ? night.people.find((person) => person.id === ownerId) : undefined;
  const personalStarts = ownerId
    ? [
        owner?.joinedAt,
        ...stops.map((stop) => stop.arrivedAt),
        ...drinks.map((drink) => drink.at),
      ].filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    : [];
  const startedAt = personalStarts.length > 0
    ? personalStarts.reduce((earliest, value) =>
        Date.parse(value) < Date.parse(earliest) ? value : earliest,
      )
    : night.startedAt;
  const personalNight = { ...night, startedAt, stops, drinks };
  const started = new Date(startedAt);
  const day = drinkingDayKey(started);
  const tally = nightTally(personalNight);
  const minutes = nightMinutes(personalNight, now);

  // In first-visit order and capped the way the server caps it: a crawl of
  // eleven pubs is a great night and a terrible headline.
  const pubNames = [...new Set(stops.map((stop) => stop.pubName).filter(Boolean))].slice(
    0,
    MAX_PUB_NAMES,
  );

  return {
    clientId: `night-${day}`,
    drinkingDay: day,
    startedAt,
    endedAt: night.endedAt ?? new Date(now).toISOString(),
    beerCount: tally.beers,
    wineCount: tally.wine,
    softDrinkCount: tally.softDrinks,
    shotCount: tally.shots,
    pubNames,
    ...(city ? { city } : {}),
    ...(minutes > 0 ? { durationMinutes: minutes } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(roastLine !== undefined ? { roastLine } : {}),
    ...(roastBasis !== undefined ? { roastBasis } : {}),
    ...(partyCode !== undefined ? { partyCode } : {}),
    ...(participantIds !== undefined ? { participantIds } : {}),
    ...(photoIds !== undefined ? { photoIds } : {}),
    ...(gameIds !== undefined ? { gameIds } : {}),
    visibility,
    updatedAt: new Date(now).toISOString(),
  };
}
