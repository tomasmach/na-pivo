/**
 * Kde se `NightRecord` bere — most mezi tím, co už existuje, a jedním tvarem.
 *
 * The record is a reading, not a store, so this is the only place that knows
 * where each part comes from. Everything else in the app takes a `NightRecord`
 * and asks it questions (`nightRecord.ts`).
 *
 * Two sources, and the split between them is what makes it correct rather than
 * merely convenient:
 *
 *   me      the local counter (`TallySession`). Instant, works in a cellar, and
 *           already the source of truth for the diary.
 *   others  the shared evening (`PartyEvening.events`), which is the server
 *           reading everybody's tagged diary rows back to us.
 *
 * Split that way because the two would otherwise DOUBLE-COUNT: my own drinks
 * come back down in the evening's events as soon as they sync, and there is no
 * shared id to dedupe them by — the server keys its events on its own row ids,
 * the counter on client ids. Taking mine from the counter and everyone else's
 * from the server means each drink has exactly one path in, my own tally never
 * waits for the network, and nothing has to be merged.
 *
 * Stops, games and photos are passed in rather than read here: the hub knows
 * them from the running night, the recap will read them from the server, and
 * this function should not care which.
 */

import type { PartyEvening } from '@/data/partyClient';
import { drinkingDayKey, type TallyDrink, type TallySession } from '@/stores/tallyStore';
import { decodeGeohash8 } from '@/data/geohash';
import { isContextPubKey, normalizeDrinkType } from '@/drinks/drinkTypes';
import type {
  NightBest,
  NightGame,
  NightPerson,
  NightPhoto,
  NightRecord,
  NightStop,
} from '@/party/nightRecord';

/**
 * Colours for the faces around the table.
 *
 * Warm, high-contrast on stout, and none of them amber — amber is yours, and a
 * table where two people are the app's own accent colour has no "you" in it.
 */
const TINTS = ['#7DD66B', '#F0BE5C', '#A8896A', '#FBF3E0', '#6FB3D9', '#D98C6F'] as const;

/** Amber: whoever is holding the phone. */
export const ME_TINT = '#E8A317';

/**
 * A stable colour for a person, from their id.
 *
 * Deterministic, so somebody is the same green on every phone at the table and
 * the same green tomorrow in the recap. Assigning by list position would repaint
 * the table every time somebody joined.
 */
export function tintFor(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return TINTS[Math.abs(hash) % TINTS.length];
}

/** Who is at the table. `me` first — the list is read as "us", not as a roster. */
export function peopleOf(evening: PartyEvening | null, meId: string, meName = 'Ty'): NightPerson[] {
  const me: NightPerson = { id: meId, name: meName, avatarUrl: null, tint: ME_TINT };
  if (!evening) return [me];
  // When somebody sat down, from the evening's own join events.
  const joinedAt = new Map<string, string>();
  for (const event of evening.events) {
    if (event.kind === 'joined' && !joinedAt.has(event.account.id)) {
      joinedAt.set(event.account.id, event.at);
    }
  }
  const withJoin = (person: NightPerson): NightPerson => {
    const at = joinedAt.get(person.id);
    return at ? { ...person, joinedAt: at } : person;
  };
  const others = evening.members
    .filter((member) => member.id !== meId)
    .map((member) =>
      withJoin({
        id: member.id,
        name: member.nickname ?? member.displayName,
        avatarUrl: member.avatarUrl,
        tint: tintFor(member.id),
      }),
    );
  return [withJoin(me), ...others];
}

/** Real stops from the counter's PubVisit/session context, in walking order. */
export function nightStopsFromSessions(sessions: TallySession[]): NightStop[] {
  return [...sessions]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((session) => {
      const coordinates =
        !isContextPubKey(session.pubKey) &&
        /^[0123456789bcdefghjkmnpqrstuvwxyz]{8}$/.test(session.pubKey)
          ? decodeGeohash8(session.pubKey)
          : null;
      return {
        id: session.clientId,
        pubName: session.pubName,
        cacheKey: isContextPubKey(session.pubKey) ? null : session.pubKey,
        arrivedAt: session.startedAt,
        ...(coordinates ? coordinates : {}),
      };
    });
}

/** My own drinks, straight off the counter — no round trip, no waiting. */
function myDrinks(
  sessions: TallySession[],
  meId: string,
  stopIds: Set<string>,
  fallbackStopId: string | null,
) {
  return sessions.flatMap((session) => {
    const stopId = stopIds.has(session.clientId) ? session.clientId : fallbackStopId;
    return session.drinks.map((drink: TallyDrink) => ({
      id: drink.id,
      at: drink.at,
      by: meId,
      beerName: drink.beerName,
      drinkType: drink.drinkType ?? ('beer' as const),
      ...(drink.volumeMl !== undefined ? { volumeMl: drink.volumeMl } : {}),
      stopId,
    }));
  });
}

/**
 * Everybody else's, as the server read them back.
 *
 * A drink from somebody who has since left the table still counts: they were
 * there and they drank it. What the server has already filtered out is the
 * people this viewer may not see at all (ghost mode, blocks) — that decision is
 * not repeated here.
 */
function theirDrinks(evening: PartyEvening | null, meId: string, stopId: string | null) {
  if (!evening) return [];
  return evening.events
    .filter((event) => event.kind === 'drink' && event.account.id !== meId)
    .flatMap((event) =>
      // `quantity` is how released apps shared "two beers" as one row.
      Array.from({ length: Math.max(1, event.quantity) }, (_, index) => ({
        id: `${event.id}:${index}`,
        at: event.at,
        by: event.account.id,
        beerName: event.beerName,
        drinkType: 'beer' as const,
        stopId,
      })),
    );
}

/**
 * The night, from everything that knows a piece of it.
 *
 * `evening` may be null — most nights are not shared, and the record is the same
 * shape for a night you spent on your own.
 */
export function buildNightRecord({
  evening,
  session,
  sessions,
  meId,
  meName,
  stops = [],
  games = [],
  photos = [],
  startedAt,
  endedAt = null,
}: {
  evening: PartyEvening | null;
  session: TallySession | null;
  /** All sittings on the drinking day; defaults to the current one. */
  sessions?: TallySession[];
  meId: string;
  meName?: string;
  stops?: NightStop[];
  games?: NightGame[];
  photos?: NightPhoto[];
  /** Defaults to the evening's start, then the session's, then now-ish. */
  startedAt?: string;
  endedAt?: string | null;
}): NightRecord {
  const localSessions = sessions ?? (session ? [session] : []);
  // Released callers passed one session plus an independently-built stop list.
  // Keep their old last-stop fallback while multi-session callers attach each
  // drink to its exact PubVisit/session id.
  const currentStop = stops.length > 0 ? stops[stops.length - 1].id : null;
  const stopIds = new Set(stops.map((stop) => stop.id));
  const started =
    startedAt ?? evening?.startedAt ?? session?.startedAt ?? new Date(0).toISOString();

  return {
    id: evening?.id ?? session?.clientId ?? 'night',
    code: evening?.joinCode ?? null,
    startedAt: started,
    endedAt: endedAt ?? evening?.endedAt ?? null,
    people: peopleOf(evening, meId, meName),
    stops,
    drinks: [
      ...myDrinks(localSessions, meId, stopIds, currentStop),
      ...theirDrinks(evening, meId, currentStop),
    ].sort((a, b) => a.at.localeCompare(b.at)),
    games,
    photos,
  };
}

/**
 * Your own best night so far, from the counter's history.
 *
 * A record is measured against YOURSELF and nobody else — this app does not
 * tell anyone they drank less than their friends. The numbers come from the
 * sessions already on the phone, so no request is needed to know whether tonight
 * beat anything.
 *
 * Sessions are grouped by DRINKING DAY, not by sitting: a pub crawl is three
 * sessions and one night, and counting them separately would mean the longest
 * night on record is however long you sat in the last pub.
 *
 * `excludeDay` keeps tonight out of its own comparison; without it every night
 * ties with itself and nothing is ever a record.
 */
export function nightBestFrom(sessions: TallySession[], excludeDay?: string): NightBest {
  const byDay = new Map<string, TallySession[]>();
  for (const session of sessions) {
    const day = drinkingDayKey(new Date(session.startedAt));
    if (day === excludeDay) continue;
    const bucket = byDay.get(day);
    if (bucket) bucket.push(session);
    else byDay.set(day, [session]);
  }

  const best: NightBest = { beers: 0, minutes: 0, stops: 0 };
  for (const nights of byDay.values()) {
    const drinks = nights.flatMap((session) => session.drinks);
    const beers = drinks.filter(
      (drink) => normalizeDrinkType(drink.drinkType) === 'beer',
    ).length;
    const stamps = drinks.map((drink) => new Date(drink.at).getTime()).sort((a, b) => a - b);
    const minutes =
      stamps.length > 1 ? Math.round((stamps[stamps.length - 1] - stamps[0]) / 60000) : 0;
    const stops = new Set(nights.map((session) => session.pubKey)).size;

    best.beers = Math.max(best.beers, beers);
    best.minutes = Math.max(best.minutes, minutes);
    best.stops = Math.max(best.stops, stops);
  }
  return best;
}
