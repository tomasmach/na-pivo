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

/** A single opening interval as [start, end] in `HH:MM` 24h local time. */
export type HoursInterval = [string, string];

/** Weekly opening hours: every day key present; empty array = closed. */
export type WeeklyHours = Record<DayKey, HoursInterval[]>;

/** Map JS Date.getDay() (0=Sun..6=Sat) onto our Monday-first day index (0=Mo). */
const JS_DAY_TO_INDEX = [6, 0, 1, 2, 3, 4, 5] as const;

/** Parse `HH:MM` into minutes since midnight, or null when malformed. */
export function parseHhMm(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
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
        parseHhMm(iv[0] as string) !== null &&
        parseHhMm(iv[1] as string) !== null,
    );
  });
}

/** An empty (all-closed) week — handy as a form default. */
export function emptyWeeklyHours(): WeeklyHours {
  return { mo: [], tu: [], we: [], th: [], fr: [], sa: [], su: [] };
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
