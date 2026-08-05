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

export function nightPublishPayload(
  night: NightRecord,
  {
    visibility,
    now,
    city,
  }: {
    visibility: NightVisibility;
    /** The instant the night is being published. Passed in, so this stays pure. */
    now: number;
    city?: string;
  },
): NightPublishPayload {
  const started = new Date(night.startedAt);
  const day = drinkingDayKey(started);
  const tally = nightTally(night);
  const minutes = nightMinutes(night, now);

  // In first-visit order and capped the way the server caps it: a crawl of
  // eleven pubs is a great night and a terrible headline.
  const pubNames = [...new Set(night.stops.map((stop) => stop.pubName).filter(Boolean))].slice(
    0,
    MAX_PUB_NAMES,
  );

  return {
    clientId: `night-${day}`,
    drinkingDay: day,
    startedAt: night.startedAt,
    endedAt: night.endedAt ?? new Date(now).toISOString(),
    beerCount: tally.beers,
    wineCount: tally.wine,
    softDrinkCount: tally.softDrinks,
    shotCount: tally.shots,
    pubNames,
    ...(city ? { city } : {}),
    ...(minutes > 0 ? { durationMinutes: minutes } : {}),
    visibility,
    updatedAt: new Date(now).toISOString(),
  };
}
