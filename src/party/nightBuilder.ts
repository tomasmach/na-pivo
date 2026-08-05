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
import type { TallyDrink, TallySession } from '@/stores/tallyStore';
import type {
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

/** My own drinks, straight off the counter — no round trip, no waiting. */
function myDrinks(session: TallySession | null, meId: string, stopId: string | null) {
  if (!session) return [];
  return session.drinks.map((drink: TallyDrink) => ({
    id: drink.id,
    at: drink.at,
    by: meId,
    beerName: drink.beerName,
    drinkType: drink.drinkType ?? ('beer' as const),
    ...(drink.volumeMl !== undefined ? { volumeMl: drink.volumeMl } : {}),
    stopId,
  }));
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
  meId: string;
  meName?: string;
  stops?: NightStop[];
  games?: NightGame[];
  photos?: NightPhoto[];
  /** Defaults to the evening's start, then the session's, then now-ish. */
  startedAt?: string;
  endedAt?: string | null;
}): NightRecord {
  // Where a drink was had: the stop that was open when it landed. One stop is
  // the common case and gets it exactly right; the walk is threaded through
  // properly once stops come from `PubVisit` rather than being passed in.
  const currentStop = stops.length > 0 ? stops[stops.length - 1].id : null;
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
      ...myDrinks(session, meId, currentStop),
      ...theirDrinks(evening, meId, currentStop),
    ].sort((a, b) => a.at.localeCompare(b.at)),
    games,
    photos,
  };
}
