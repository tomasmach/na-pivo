/**
 * Pure helpers for the structured weekly opening-hours model that users submit
 * and that the backend echoes back for community-sourced pubs.
 *
 * `WeeklyHours` is a 7-key object (mo..su); each day is a list of [start, end]
 * `HH:MM` intervals. An empty list means closed that day. An interval whose end
 * is <= its start is an OVERNIGHT interval (e.g. 22:00–02:00) — it stays open
 * past midnight into the next day.
 *
 * These helpers let the app compute isOpenNow / nextChange for a locally-stored
 * override WITHOUT a backend round-trip, so the OpenStatusChip stays correct the
 * instant a user submits an edit (even offline). They are deliberately pure and
 * dependency-free so the logic is unit-testable.
 */

/** Day keys in week order, Monday first (matches the backend contract). */
export const DAY_KEYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/**
 * A single beer on tap, in app (camelCase) form. Declared here — in the
 * dependency-free helpers module — so modules that must NOT pull in the
 * account/secure-store chain (e.g. hoursClient) can import the type and the
 * wire-mapping helpers without dragging in communityClient.
 */
export interface CommunityBeer {
  name: string;
  /** Price in CZK; optional (1–1000). */
  priceCzk?: number;
  /** Serving volume in millilitres; optional, one of {300,330,400,500,1000}. */
  volumeMl?: number;
}

/** A single beer in backend (snake_case) wire form. */
export interface WireBeer {
  name: string;
  price_czk?: number;
  volume_ml?: number;
}

/** Map a camelCase beer to its snake_case wire form, dropping empty optionals. */
export function beerToWire(beer: CommunityBeer): WireBeer {
  const wire: WireBeer = { name: beer.name };
  if (typeof beer.priceCzk === 'number') wire.price_czk = beer.priceCzk;
  if (typeof beer.volumeMl === 'number') wire.volume_ml = beer.volumeMl;
  return wire;
}

/** Map a snake_case wire beer back to camelCase app form. */
export function beerFromWire(beer: WireBeer): CommunityBeer {
  const app: CommunityBeer = { name: beer.name };
  if (typeof beer.price_czk === 'number') app.priceCzk = beer.price_czk;
  if (typeof beer.volume_ml === 'number') app.volumeMl = beer.volume_ml;
  return app;
}

/**
 * Serving volumes (in millilitres) the community write endpoint accepts.
 * Mirrors the backend CommunityBeerSerializer's `volume_ml` choices — keep the
 * two in sync. The menu-scan helper canonicalizes over a much wider range, so a
 * scan can hand back an in-range-but-disallowed value (e.g. 250/700/750) that
 * the write endpoint would reject with a 400; such volumes must be dropped
 * before submit or the whole contribution loops forever in the retry queue.
 */
export const ALLOWED_BEER_VOLUMES_ML: readonly number[] = [300, 330, 400, 500, 1000];

/** True when `volumeMl` is one the community write endpoint will accept. */
export function isAllowedBeerVolume(volumeMl: number | undefined): boolean {
  return typeof volumeMl === 'number' && ALLOWED_BEER_VOLUMES_ML.includes(volumeMl);
}

/** The most beers a community menu may hold — mirrors the backend cap. */
export const MAX_MENU_BEERS = 12;
export const MAX_HISTORICAL_MENU_BEERS = 24;

/** Normalize a beer name for identity comparison: trim + lowercase (casefold). */
export function normalizeBeerName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Two beers share a menu identity when their normalized names AND serving volumes
 * both agree, so "Plzeň 0,5" and "Plzeň 0,3" stay separate rows. A missing volume
 * is its own bucket (undefined === undefined matches). This single rule is shared
 * by the community-menu merge and the scan-into-editor merge, and mirrors the
 * backend merge rule — keep all three in sync via this one predicate.
 */
export function isSameBeerIdentity(
  a: { name: string; volumeMl?: number },
  b: { name: string; volumeMl?: number },
): boolean {
  return normalizeBeerName(a.name) === normalizeBeerName(b.name) && a.volumeMl === b.volumeMl;
}

/**
 * Merge one drunk/added beer into a community menu, returning a NEW list.
 *
 * Mirrors the backend merge rule exactly so the optimistic local menu matches
 * what the server will store:
 *  - find an existing beer with the same normalized name AND same volumeMl →
 *    update its priceCzk to the incoming price (canonicalized copy);
 *  - else append the beer when the menu has room (< MAX_MENU_BEERS);
 *  - else (menu full) leave the list unchanged.
 *
 * Two beers match only when BOTH name and volume agree, so "Plzeň 0,5" and
 * "Plzeň 0,3" stay separate menu rows (different prices). A missing volume on
 * either side is treated as its own bucket (undefined === undefined matches).
 */
export function mergeBeerIntoMenu(
  menu: readonly CommunityBeer[],
  beer: CommunityBeer,
): CommunityBeer[] {
  let matched = false;
  const next = menu.map((existing) => {
    if (!matched && isSameBeerIdentity(existing, beer)) {
      matched = true;
      const merged: CommunityBeer = { name: existing.name };
      if (typeof beer.priceCzk === 'number') merged.priceCzk = beer.priceCzk;
      if (typeof existing.volumeMl === 'number') merged.volumeMl = existing.volumeMl;
      return merged;
    }
    return existing;
  });

  if (matched) return next;
  if (next.length >= MAX_MENU_BEERS) return next;

  const appended: CommunityBeer = { name: beer.name.trim() };
  if (typeof beer.priceCzk === 'number') appended.priceCzk = beer.priceCzk;
  if (typeof beer.volumeMl === 'number') appended.volumeMl = beer.volumeMl;
  next.push(appended);
  return next;
}

/**
 * Build the bounded restore history after a user confirms a full current menu.
 * Removed current rows are newest, existing history follows, and anything back
 * on tap is removed from history. Mirrors the backend lifecycle helper.
 */
export function historicalBeersAfterMenuReplacement(
  current: readonly CommunityBeer[],
  replacement: readonly CommunityBeer[],
  historical: readonly CommunityBeer[],
): CommunityBeer[] {
  const isIn = (list: readonly CommunityBeer[], beer: CommunityBeer) =>
    list.some((candidate) => isSameBeerIdentity(candidate, beer));
  const next: CommunityBeer[] = [];

  for (const beer of [...current.filter((item) => !isIn(replacement, item)), ...historical]) {
    if (!normalizeBeerName(beer.name) || isIn(replacement, beer) || isIn(next, beer)) continue;
    next.push({ ...beer });
    if (next.length >= MAX_HISTORICAL_MENU_BEERS) break;
  }
  return next;
}

/** A single opening interval as [start, end] in `HH:MM` 24h local time. */
export type HoursInterval = [string, string];

/** Weekly opening hours: every day key present; empty array = closed. */
export type WeeklyHours = Record<DayKey, HoursInterval[]>;

/** Map JS Date.getDay() (0=Sun..6=Sat) onto our Monday-first day index (0=Mo). */
const JS_DAY_TO_INDEX = [6, 0, 1, 2, 3, 4, 5] as const;
const OSM_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const OSM_DAY_TO_KEY: Record<(typeof OSM_DAYS)[number], DayKey> = {
  Mo: 'mo',
  Tu: 'tu',
  We: 'we',
  Th: 'th',
  Fr: 'fr',
  Sa: 'sa',
  Su: 'su',
};
const DASH_CHARS = /[–—−]/g;
const MAX_INTERVALS_PER_DAY = 3;

/** Parse `HH:MM` into minutes since midnight, or null when malformed. */
export function parseHhMm(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** True when an editable interval is well-formed and non-empty. */
export function isValidHoursInterval([start, end]: HoursInterval): boolean {
  return parseHhMm(start) !== null && parseHhMm(end) !== null && start !== end;
}

/** Format minutes-since-midnight (may exceed 24h) back into `HH:MM` (mod 24h). */
export function formatHhMm(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** True when every day key is present and shaped like a list of HH:MM pairs. */
export function isWeeklyHours(value: unknown): value is WeeklyHours {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return DAY_KEYS.every((day) => {
    const intervals = obj[day];
    if (!Array.isArray(intervals)) return false;
    return intervals.every(
      (iv) =>
        Array.isArray(iv) &&
        iv.length === 2 &&
        isValidHoursInterval([iv[0] as string, iv[1] as string]),
    );
  });
}

/** An empty (all-closed) week — handy as a form default. */
export function emptyWeeklyHours(): WeeklyHours {
  return { mo: [], tu: [], we: [], th: [], fr: [], sa: [], su: [] };
}

function cloneWeeklyHours(hours: WeeklyHours): WeeklyHours {
  return {
    mo: hours.mo.map((iv): HoursInterval => [iv[0], iv[1]]),
    tu: hours.tu.map((iv): HoursInterval => [iv[0], iv[1]]),
    we: hours.we.map((iv): HoursInterval => [iv[0], iv[1]]),
    th: hours.th.map((iv): HoursInterval => [iv[0], iv[1]]),
    fr: hours.fr.map((iv): HoursInterval => [iv[0], iv[1]]),
    sa: hours.sa.map((iv): HoursInterval => [iv[0], iv[1]]),
    su: hours.su.map((iv): HoursInterval => [iv[0], iv[1]]),
  };
}

function parseOsmDayToken(token: string): DayKey[] | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const range = /^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/.exec(trimmed);
  if (range) {
    const start = OSM_DAYS.indexOf(range[1] as (typeof OSM_DAYS)[number]);
    const end = OSM_DAYS.indexOf(range[2] as (typeof OSM_DAYS)[number]);
    if (start < 0 || end < 0) return null;

    const days: DayKey[] = [];
    for (let i = start; ; i = (i + 1) % OSM_DAYS.length) {
      days.push(OSM_DAY_TO_KEY[OSM_DAYS[i]]);
      if (i === end) break;
    }
    return days;
  }

  if (/^(Mo|Tu|We|Th|Fr|Sa|Su)$/.test(trimmed)) {
    return [OSM_DAY_TO_KEY[trimmed as (typeof OSM_DAYS)[number]]];
  }

  return null;
}

function parseOsmDays(value: string): DayKey[] | null {
  const days: DayKey[] = [];
  const seen = new Set<DayKey>();

  for (const rawToken of value.split(',')) {
    const parsed = parseOsmDayToken(rawToken);
    if (!parsed) return null;
    for (const day of parsed) {
      if (!seen.has(day)) {
        seen.add(day);
        days.push(day);
      }
    }
  }

  return days.length > 0 ? days : null;
}

function normalizeOsmTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseOsmIntervals(value: string): HoursInterval[] | null {
  const timePart = value.trim();
  if (!timePart) return [['00:00', '24:00']];
  if (/^off$/i.test(timePart)) return null;

  const intervals: HoursInterval[] = [];
  for (const rawInterval of timePart.split(',')) {
    const match = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(rawInterval.trim());
    if (!match) return null;

    const start = normalizeOsmTime(match[1]);
    const end = normalizeOsmTime(match[2]);
    if (!start || !end || start === end) return null;
    intervals.push([start, end]);
  }

  return intervals.length > 0 ? intervals : null;
}

/**
 * Convert the OSM opening_hours subset emitted by the backend's Firmy.cz
 * normalizer into the app's editable weekly form model.
 *
 * Supported examples:
 *   - "Mo-Su 10:00-23:00"
 *   - "Mo,Tu,We,Th,Fr,Sa 11:00-22:00"
 *   - "Tu,We,Th 17:00-22:00; Fr,Sa 17:00-00:00"
 *   - "Mo 10:00-14:00,17:00-22:00"
 *
 * Unsupported OSM constructs return null so callers do not prefill misleading
 * values.
 */
export function parseOsmOpeningHoursToWeeklyHours(value: string | null | undefined): WeeklyHours | null {
  const source = value?.trim().replace(DASH_CHARS, '-');
  if (!source) return null;

  if (source === '24/7') {
    return {
      mo: [['00:00', '24:00']],
      tu: [['00:00', '24:00']],
      we: [['00:00', '24:00']],
      th: [['00:00', '24:00']],
      fr: [['00:00', '24:00']],
      sa: [['00:00', '24:00']],
      su: [['00:00', '24:00']],
    };
  }

  const out = emptyWeeklyHours();
  for (const rawRule of source.split(';')) {
    const rule = rawRule.trim();
    if (!rule) continue;

    const firstSpace = rule.search(/\s/);
    const dayPart = firstSpace >= 0 ? rule.slice(0, firstSpace) : rule;
    const timePart = firstSpace >= 0 ? rule.slice(firstSpace).trim() : '';
    const days = parseOsmDays(dayPart);
    const intervals = parseOsmIntervals(timePart);
    if (!days || !intervals) return null;

    for (const day of days) {
      out[day].push(...intervals.map((iv): HoursInterval => [iv[0], iv[1]]));
      if (out[day].length > MAX_INTERVALS_PER_DAY) return null;
    }
  }

  return cloneWeeklyHours(out);
}

export interface OpenState {
  /** Whether the pub is open at `now`. */
  isOpenNow: boolean;
  /**
   * ISO-8601 local timestamp (no zone suffix) of the next open↔close transition,
   * or null when the schedule never changes within the next week. The
   * OpenStatusChip only reads the `HH:MM` slice after the `T`, so a bare local
   * timestamp is sufficient and avoids any timezone math.
   */
  nextChange: string | null;
}

/** Format a Date into a bare-local ISO `YYYY-MM-DDTHH:MM:00` (no zone). */
function toLocalIso(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:00`;
}

/**
 * Compute open/closed + next transition for a WeeklyHours schedule at `now`.
 *
 * Handles:
 *  - closed days (empty interval list),
 *  - multiple intervals per day,
 *  - overnight intervals (end <= start) that spill into the following day,
 *  - the midnight boundary (an interval that is still running from yesterday).
 *
 * The scan walks minute-boundaries forward for up to 8 days to find the next
 * change; if the schedule is open or closed for the whole horizon, nextChange is
 * null. `now` defaults to the current device time.
 */
export function computeOpenState(hours: WeeklyHours, now: Date = new Date()): OpenState {
  const nowMinutesOfWeek = JS_DAY_TO_INDEX[now.getDay()] * 1440 + now.getHours() * 60 + now.getMinutes();

  // Expand the week into absolute [start, end) minute-of-week segments, carrying
  // overnight intervals into the next day (and wrapping Sunday→Monday). A second
  // copy shifted by one week lets a segment starting late on Sunday extend past
  // the week boundary without special-casing.
  const segments: [number, number][] = [];
  DAY_KEYS.forEach((day, dayIdx) => {
    for (const [startStr, endStr] of hours[day]) {
      const start = parseHhMm(startStr);
      const end = parseHhMm(endStr);
      if (start === null || end === null) continue;
      const base = dayIdx * 1440;
      // Overnight (or full-day) when end <= start: it runs into the next day.
      const span = end <= start ? end + 1440 : end;
      segments.push([base + start, base + span]);
    }
  });

  const WEEK = 7 * 1440;
  // Duplicate every segment +1 week so a "currently open since last week" or
  // "next open early next week" lookup is covered by a simple forward scan.
  const allSegments = segments
    .flatMap(([s, e]) => [
      [s, e] as [number, number],
      [s + WEEK, e + WEEK] as [number, number],
    ])
    .sort((a, b) => a[0] - b[0]);

  // Are we inside any segment right now? Check both this week and the previous
  // week's overnight spillover (now + WEEK falls into a +WEEK-shifted segment,
  // OR an un-shifted segment that started before midnight Monday).
  const nowCandidates = [nowMinutesOfWeek, nowMinutesOfWeek + WEEK];
  let openSegmentEnd: number | null = null;
  for (const t of nowCandidates) {
    for (const [s, e] of allSegments) {
      if (s <= t && t < e) {
        openSegmentEnd = e;
        break;
      }
    }
    if (openSegmentEnd !== null) break;
  }

  if (openSegmentEnd !== null) {
    // Open now → next change is when the current segment ends, UNLESS another
    // segment begins immediately at that boundary (back-to-back), in which case
    // we keep extending until there is a genuine gap.
    let end = openSegmentEnd;
    let extended = true;
    while (extended) {
      extended = false;
      for (const [s, e] of allSegments) {
        if (s <= end && end < e) {
          end = e;
          extended = true;
        }
      }
    }
    return {
      isOpenNow: true,
      nextChange: toLocalIso(new Date(now.getTime() + (end - nowMinutesOfWeek) * 60000)),
    };
  }

  // Closed now → find the next segment start at or after now.
  for (const [s] of allSegments) {
    if (s > nowMinutesOfWeek) {
      return {
        isOpenNow: false,
        nextChange: toLocalIso(new Date(now.getTime() + (s - nowMinutesOfWeek) * 60000)),
      };
    }
  }

  // No segments at all (always closed) → no upcoming change.
  return { isOpenNow: false, nextChange: null };
}
