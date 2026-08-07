/**
 * Večer jako data — jeden tvar, ze kterého se čte hub, recap i post.
 *
 * Until now a night existed three times: the running hub had one shape, the
 * recap another, the feed card a third, and none of them could be derived from
 * the others. That is why nothing composed — a number on the recap could not
 * appear on the card without being typed in again.
 *
 * So: one record, and every statistic is a PURE FUNCTION of it. Nothing here is
 * stored, cached or incremented. If a drink is taken back, every number that
 * mentioned it changes, because there is nowhere else for it to live.
 *
 * The record itself is only a reading of rows that already exist:
 *
 *   people   PartyEveningMember
 *   drinks   DrinkLog, tagged with the evening (party_code)
 *   stops    PubVisit
 *   games    PartyGame + PartyGameEvent
 *   photos   BeerPhoto
 *
 * Nothing new is persisted for a party. A shared table is a lens over the diary
 * — see `docs/decisions/one-write-two-readers.md`.
 *
 * Rules worth stating, because they are product decisions and not maths:
 *
 *   1. A "beer" is a beer. Soft drinks, shots and wine are counted, but never
 *      as beers — a night of three radlers is not a three-beer night.
 *   2. A tie is a tie. The MVP is null when two people share the top, exactly
 *      like the quiz: inventing a tie-break nobody agreed to is how an evening
 *      ends in an argument about the app.
 *   3. An empty hour still gets a bar. Dropping it would draw a night as
 *      steadier than it was, and the tempo chart is read as a shape.
 *   4. Prices, spend, per-mille and BAC do not appear here, ever
 *      (`docs/decisions/no-bac-or-driving-estimates.md`).
 */

import { normalizeDrinkType, type DrinkType } from '@/drinks/drinkTypes';

export interface NightPerson {
  /** Account public id, or a local id for a guest. */
  id: string;
  /** Handle, not a legal name — nobody is "Jan Novák" at the table. */
  name: string;
  avatarUrl: string | null;
  /** Colour seed for the initials avatar. */
  tint: string;
  /** When they sat down. Absent for a night nobody shared. */
  joinedAt?: string;
  /** False after leaving; recap keeps the person, live UI filters them out. */
  active?: boolean;
  leftAt?: string;
}

export interface NightStop {
  id: string;
  /** Account that recorded this visit. Absent on legacy/local-only records. */
  by?: string;
  pubName: string;
  /** Geohash-8 of the pub, the app's identity for a place. Null off-grid. */
  cacheKey: string | null;
  /** ISO-8601. */
  arrivedAt: string;
  /**
   * The PUB's coordinates, never the phone's.
   *
   * The recap and the feed card draw the walk from these. They are a public
   * place's location, which is a different thing from where a person was —
   * raw GPS never leaves the device (`AGENTS.md`).
   */
  lat?: number;
  lng?: number;
}

export interface NightDrink {
  id: string;
  /** ISO-8601, when it was drunk. */
  at: string;
  /** `NightPerson.id`. */
  by: string;
  beerName: string;
  drinkType: DrinkType;
  volumeMl?: number;
  /** `NightStop.id` — where it was drunk. Null outside a pub. */
  stopId: string | null;
}

export interface NightGame {
  key: string;
  name: string;
  startedAt: string;
  /** Account that put the game on the table. */
  by?: string;
  /** Absent while it is still being played. */
  result?: {
    /** Null for a game scored in sips — see `gameCatalog.ts`. */
    winner: string | null;
    paying?: string | null;
    scores: { name: string; score: number }[];
  };
}

export interface NightPhoto {
  id: string;
  url: string;
  at: string;
  /** `NightPerson.id`. */
  by: string;
}

export interface NightRecord {
  id: string;
  /** The shared evening's join code, when this night is a shared one. */
  code: string | null;
  startedAt: string;
  /** Null while it is still running. */
  endedAt: string | null;
  people: NightPerson[];
  stops: NightStop[];
  drinks: NightDrink[];
  games: NightGame[];
  photos: NightPhoto[];
}

const ms = (iso: string): number => new Date(iso).getTime();

function isBeer(drink: NightDrink): boolean {
  return normalizeDrinkType(drink.drinkType) === 'beer';
}

/** An empty night, for a hub that has not had its first beer yet. */
export function emptyNight(id: string, startedAt: string, code: string | null = null): NightRecord {
  return { id, code, startedAt, endedAt: null, people: [], stops: [], drinks: [], games: [], photos: [] };
}

/**
 * How long it has been going, in minutes.
 *
 * `now` rather than `Date.now()` so this stays pure and a test can say what
 * time it is. A running night measures to now; a finished one to when it ended.
 */
export function nightMinutes(night: NightRecord, now: number): number {
  const end = night.endedAt ? ms(night.endedAt) : now;
  return Math.max(0, Math.round((end - ms(night.startedAt)) / 60000));
}

export interface NightTally {
  beers: number;
  softDrinks: number;
  shots: number;
  wine: number;
}

function emptyTally(): NightTally {
  return { beers: 0, softDrinks: 0, shots: 0, wine: 0 };
}

function count(tally: NightTally, drink: NightDrink): void {
  switch (normalizeDrinkType(drink.drinkType)) {
    case 'beer':
      tally.beers += 1;
      break;
    case 'soft_drink':
      tally.softDrinks += 1;
      break;
    case 'shot':
      tally.shots += 1;
      break;
    case 'wine':
      tally.wine += 1;
      break;
  }
}

/**
 * Whoever is holding the phone.
 *
 * Always first in the list — `peopleOf` builds it that way, because the table is
 * read as "us" and not as a roster. Null before anybody is known.
 */
export function nightMe(night: NightRecord): NightPerson | null {
  return night.people[0] ?? null;
}

/**
 * One person's beers.
 *
 * The difference between this and `nightTally` is the difference between "your
 * fourth" and "the table's twelfth", and both appear on the same screen — the
 * top strip counts yours, the stats count the table's.
 */
export function beersOf(night: NightRecord, personId: string | undefined): number {
  if (!personId) return 0;
  return night.drinks.filter((drink) => drink.by === personId && isBeer(drink)).length;
}

/** The whole night, by category. */
export function nightTally(night: NightRecord): NightTally {
  const tally = emptyTally();
  for (const drink of night.drinks) count(tally, drink);
  return tally;
}

export interface NightStanding extends NightPerson {
  beers: number;
  /** Everything else they had, so the row can say "a dvě nealko". */
  tally: NightTally;
}

/**
 * Who drank what, best first.
 *
 * Everybody at the table appears, including whoever has had nothing — a person
 * who joined and is not on the list reads as a bug, not as a zero.
 */
export function nightStandings(night: NightRecord): NightStanding[] {
  const byPerson = new Map<string, NightTally>(
    night.people.map((person) => [person.id, emptyTally()]),
  );
  for (const drink of night.drinks) {
    const tally = byPerson.get(drink.by);
    if (tally) count(tally, drink);
  }
  return night.people
    .map((person) => {
      const tally = byPerson.get(person.id) ?? emptyTally();
      return { ...person, beers: tally.beers, tally };
    })
    .sort((a, b) => b.beers - a.beers || a.name.localeCompare(b.name, 'cs'));
}

/**
 * Tonight's MVP, or null when the top is shared.
 *
 * Null on a tie and null on an all-zero night, the same rule the quiz uses.
 */
export function nightMvp(standings: NightStanding[]): NightStanding | null {
  const top = standings[0];
  if (!top || top.beers === 0) return null;
  const shared = standings.filter((row) => row.beers === top.beers).length > 1;
  return shared ? null : top;
}

export interface NightHourBucket {
  /** Local hour, two digits — "20", "01". */
  hour: string;
  beers: number;
}

/**
 * The tempo, hour by hour, from the first drink to the last.
 *
 * Empty hours in the middle are kept: a night with nothing between midnight and
 * two is a night with a gap, and dropping the gap draws it as steady.
 */
export function nightHourly(night: NightRecord): NightHourBucket[] {
  const beers = night.drinks.filter(isBeer).map((drink) => new Date(drink.at));
  if (beers.length === 0) return [];

  const stamps = beers.map((date) => date.getTime()).sort((a, b) => a - b);
  const floorHour = (value: number): number => {
    const date = new Date(value);
    date.setMinutes(0, 0, 0);
    return date.getTime();
  };
  const first = floorHour(stamps[0]);
  const last = floorHour(stamps[stamps.length - 1]);

  const counts = new Map<number, number>();
  for (const stamp of stamps) {
    const bucket = floorHour(stamp);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  const out: NightHourBucket[] = [];
  const HOUR = 60 * 60 * 1000;
  for (let at = first; at <= last; at += HOUR) {
    out.push({
      hour: String(new Date(at).getHours()).padStart(2, '0'),
      beers: counts.get(at) ?? 0,
    });
  }
  return out;
}

export interface NightBeerCount {
  beer: string;
  count: number;
}

/**
 * What was actually drunk, most first.
 *
 * Grouped case-insensitively but shown as first written: "plzeň" and "Plzeň"
 * are the same beer, and the table typed the second one.
 */
export function nightByBeer(night: NightRecord): NightBeerCount[] {
  const groups = new Map<string, NightBeerCount>();
  for (const drink of night.drinks) {
    const key = drink.beerName.trim().toLocaleLowerCase('cs');
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { beer: drink.beerName.trim(), count: 1 });
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.beer.localeCompare(b.beer, 'cs'),
  );
}

export interface NightStopTally extends NightStop {
  beers: number;
  /** Minutes spent here — to the next stop, or to the end of the night. */
  minutes: number;
}

function stopIdentity(stop: NightStop): string {
  return stop.cacheKey || stop.pubName.trim().toLocaleLowerCase('cs');
}

/** Collapse one shared venue reported once per participant into one table stop. */
export function uniqueNightStops(night: NightRecord): NightStop[] {
  const ordered = [...night.stops].sort((a, b) => ms(a.arrivedAt) - ms(b.arrivedAt));
  const unique: NightStop[] = [];
  for (const stop of ordered) {
    const previous = unique.at(-1);
    if (previous && stopIdentity(previous) === stopIdentity(stop)) continue;
    unique.push(stop);
  }
  return unique;
}

/** The walk: each stop with what happened there, in the order it happened. */
export function nightStops(night: NightRecord, now: number): NightStopTally[] {
  const ordered = uniqueNightStops(night);
  const canonicalByStop = new Map<string, string>();
  let groupIndex = -1;
  let previousIdentity = '';
  for (const stop of [...night.stops].sort((a, b) => ms(a.arrivedAt) - ms(b.arrivedAt))) {
    const identity = stopIdentity(stop);
    if (identity !== previousIdentity) groupIndex += 1;
    const canonical = ordered[groupIndex];
    if (canonical) canonicalByStop.set(stop.id, canonical.id);
    previousIdentity = identity;
  }
  const beersAt = new Map<string, number>();
  for (const drink of night.drinks) {
    if (!drink.stopId || !isBeer(drink)) continue;
    const stopId = canonicalByStop.get(drink.stopId) ?? drink.stopId;
    beersAt.set(stopId, (beersAt.get(stopId) ?? 0) + 1);
  }
  const end = night.endedAt ? ms(night.endedAt) : now;
  return ordered.map((stop, index) => {
    const left = index + 1 < ordered.length ? ms(ordered[index + 1].arrivedAt) : end;
    return {
      ...stop,
      beers: beersAt.get(stop.id) ?? 0,
      minutes: Math.max(0, Math.round((left - ms(stop.arrivedAt)) / 60000)),
    };
  });
}

/** Games that actually finished — the only ones with anything to show. */
export function nightPlayedGames(night: NightRecord): NightGame[] {
  return night.games.filter((game) => game.result);
}

export interface NightBest {
  /** Most beers in one night. */
  beers: number;
  /** Longest night, in minutes. */
  minutes: number;
  /** Most pubs in one night. */
  stops: number;
}

export interface NightBroken {
  kind: 'beers' | 'minutes' | 'stops';
  /** Tonight's number. */
  value: number;
  /** What it beat. */
  previous: number;
}

/**
 * What tonight beat, against this account's own history.
 *
 * Strictly greater: equalling a record is not breaking it, and a night that
 * announces a record for matching last Tuesday cheapens the ones that are real.
 * Nothing is compared against other people — a record here is yours, never a
 * ranking of the table.
 */
export function nightBrokenRecords(
  night: NightRecord,
  best: NightBest,
  now: number,
): NightBroken[] {
  const broken: NightBroken[] = [];
  const beers = nightTally(night).beers;
  const minutes = nightMinutes(night, now);
  const stops = uniqueNightStops(night).length;

  if (beers > best.beers) broken.push({ kind: 'beers', value: beers, previous: best.beers });
  if (minutes > best.minutes) {
    broken.push({ kind: 'minutes', value: minutes, previous: best.minutes });
  }
  if (stops > best.stops) broken.push({ kind: 'stops', value: stops, previous: best.stops });
  return broken;
}

/**
 * Beers per hour, for the roast rules and the pace lines.
 *
 * Null under twenty minutes: a rate computed over five minutes says a table is
 * drinking twelve an hour, which is arithmetic rather than a fact about anyone.
 */
export function nightPerHour(night: NightRecord, now: number): number | null {
  const minutes = nightMinutes(night, now);
  if (minutes < 20) return null;
  return nightTally(night).beers / (minutes / 60);
}

/**
 * The thread: everything that happened, in order, with who did it.
 *
 * This is the hub's log and the recap's timeline — one function, because they
 * are the same list read at two moments. Derived rather than appended to, so a
 * beer taken back leaves the thread as well as the totals; a stored log would
 * keep the row and quietly disagree with the numbers above it.
 *
 * At a table of four, an entry with no name is the app talking to itself, so
 * every entry carries its author.
 */
export type NightThreadKind = 'beer' | 'photo' | 'game' | 'join' | 'pub';

export interface NightThreadEntry {
  id: string;
  at: string;
  kind: NightThreadKind;
  /** `NightPerson.id`, or null for something the night did rather than a person. */
  by: string | null;
  /** Which drink / photo / game / stop it was, so a row can act on it. */
  refId: string;
  /** Beer name, pub name, game name — whatever the row is about. */
  label: string;
  /** `beer` rows only: their nth beer of the night, counted per person. */
  ordinal?: number;
  /** `photo` rows only. */
  url?: string;
  /** `game` rows only: what the row can start. */
  gameKey?: string;
}

/**
 * What comes first when two things share a timestamp.
 *
 * You sit down, you are at a pub, you order — a beer above the join event that
 * let you have it reads as a glitch. Timestamps collide often here: the first
 * beer, the first stop and the host's own join all land in the same second when
 * a night starts.
 */
const KIND_ORDER: Record<NightThreadKind, number> = {
  join: 0,
  pub: 1,
  beer: 2,
  game: 3,
  photo: 4,
};

export function nightThread(night: NightRecord): NightThreadEntry[] {
  const entries: NightThreadEntry[] = [];

  for (const person of night.people) {
    if (!person.joinedAt) continue;
    entries.push({
      id: `join:${person.id}`,
      at: person.joinedAt,
      kind: 'join',
      by: person.id,
      refId: person.id,
      label: person.name,
    });
  }

  for (const stop of uniqueNightStops(night)) {
    entries.push({
      id: `pub:${stop.id}`,
      at: stop.arrivedAt,
      kind: 'pub',
      by: stop.by ?? null,
      refId: stop.id,
      label: stop.pubName,
    });
  }

  // "Your third beer" — counted per person over the night in the order things
  // happened, so somebody else's row counts theirs and not the table's.
  const nth = new Map<string, number>();
  for (const drink of [...night.drinks].sort((a, b) => a.at.localeCompare(b.at))) {
    const ordinal = (nth.get(drink.by) ?? 0) + 1;
    nth.set(drink.by, ordinal);
    entries.push({
      id: `beer:${drink.id}`,
      at: drink.at,
      kind: 'beer',
      by: drink.by,
      refId: drink.id,
      label: drink.beerName,
      ordinal,
    });
  }

  for (const photo of night.photos) {
    entries.push({
      id: `photo:${photo.id}`,
      at: photo.at,
      kind: 'photo',
      by: photo.by,
      refId: photo.id,
      label: 'Fotka',
      url: photo.url,
    });
  }

  for (const game of night.games) {
    entries.push({
      id: `game:${game.key}:${game.startedAt}`,
      at: game.startedAt,
      kind: 'game',
      by: game.by ?? null,
      refId: game.key,
      label: game.name,
      gameKey: game.key,
    });
  }

  return entries.sort(
    (a, b) =>
      a.at.localeCompare(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  );
}
