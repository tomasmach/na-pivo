/**
 * Local beer-counting tally ("Počítadlo").
 *
 * The user counts beers while sitting at a pub: each count records WHICH beer
 * and its PRICE. The running session lives here (persisted) so the count and
 * total survive an app restart mid-session, and finished sessions are archived
 * to a capped history.
 *
 * A "session" is one sitting at one pub on one drinking day. It rolls over —
 * archiving the current one and starting a fresh one — when EITHER:
 *   • the pub changes (different geohash-8 cell), OR
 *   • the drinking day changes. The drinking day uses a 04:00 local cutoff so a
 *     beer at 01:30 still belongs to the previous evening's session, not a new
 *     one. We implement this as "local time minus 4 hours, compared by calendar
 *     date" — purely on the device clock, no timezone library.
 *
 * This store is the source of truth for the LOCAL view. Delivery to the backend
 * + the community menu override are handled by the caller (drinksQueue +
 * communityStore), keyed by the same client_id / geohash-8 cell.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { generateUuidV4 } from '@/data/account';
import {
  normalizeDrinkType,
  normalizePlaceContext,
  type DrinkType,
  type PlaceContext,
  type ServingType,
} from '@/drinks/drinkTypes';

/** Hours to subtract from local time before taking the calendar date, so the
 *  "drinking day" rolls at 04:00 local rather than at midnight. */
const DAY_CUTOFF_HOURS = 4;
/** Keep at most this many finished sessions in history. */
const MAX_HISTORY = 50;
/** Idle window after which a still-open session auto-completes into history. A
 *  session left untouched this long (since its last counted beer) is treated as
 *  "the evening is over" — we archive it so the counter starts clean. Measured
 *  from the last drink, NOT the session start. */
export const IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/** Why a session was archived into history. `timeout` marks an auto-completed
 *  evening that the user can still resume (same pub, same drinking day); the
 *  rollover reasons are recorded for completeness and are never resumable. */
export type ArchivedReason = 'timeout' | 'pub-change' | 'day-rollover' | 'manual';

/** A single counted beer. `id` doubles as the drink's client_id (idempotency
 *  key) so the caller can dequeue / undo the exact same event. */
export interface TallyDrink {
  id: string;
  beerName: string;
  /** Missing on persisted v1 rows means beer. */
  drinkType?: DrinkType;
  /** Optional only for drinks outside a pub (price unknown at home); every
   *  pub-counted drink still carries one. */
  priceCzk?: number;
  volumeMl?: number;
  /** How the beer was served (lahváč/plechovka…). Missing means unknown. */
  servingType?: ServingType;
  /** ISO-8601 timestamp of when it was counted. */
  at: string;
  /** Delivery state for undo safety. Pending drinks may still be removed from the queue. */
  syncStatus?: 'pending' | 'sent';
}

/** One sitting at one place on one drinking day. Usually a pub; an outside
 *  evening ("mimo hospodu") uses a synthetic `ctx:*` pubKey, a display label in
 *  pubName and carries its placeContext explicitly. */
export interface TallySession {
  /** Stable per-session id, generated once when the session is opened. It is the
   *  idempotency key for the /v1/pub-visits sync (a "visit" = one evening), so a
   *  re-sent visit upsert never duplicates the record server-side. */
  clientId: string;
  /** geohash-8 cell of the pub — the durable physical-place key. */
  pubKey: string;
  pubName: string;
  /** Confirmed pub metadata used by the private visit history/map. */
  pubCity?: string;
  pubExternalId?: string;
  /** Where the evening happens. Missing on persisted sessions means `pub`. */
  placeContext?: PlaceContext;
  /** ISO-8601 timestamp of when the session started (first drink). */
  startedAt: string;
  drinks: TallyDrink[];
  /** Set only on archived (history) sessions — why the evening was closed. The
   *  live `current` session never carries it. Drives the resume affordance. */
  archivedReason?: ArchivedReason;
}

/** The minimal place identity a count needs. */
export interface TallyPub {
  pubKey: string;
  pubName: string;
  pubCity?: string;
  pubExternalId?: string;
  /** Missing means pub. */
  placeContext?: PlaceContext;
}

/** The beer being counted. */
export interface TallyBeerInput {
  id: string;
  beerName: string;
  drinkType?: DrinkType;
  /** Optional only outside a pub. */
  priceCzk?: number;
  volumeMl?: number;
  servingType?: ServingType;
  /** ISO timestamp; defaults to now. */
  at?: string;
}

export interface RemovedDrinkResult {
  drinkId: string;
  sessionClientId: string;
  remainingDrinks: number;
}

interface TallyState {
  current: TallySession | null;
  history: TallySession[];
  /**
   * Count one beer at `pub`. Starts a new session when there is none, when the
   * pub changed, or when the drinking day rolled over (04:00 cutoff) — archiving
   * the previous session into history first.
   */
  addDrink: (pub: TallyPub, beer: TallyBeerInput) => void;
  /**
   * File a BACKDATED drink into a past evening without ever touching the live
   * `current` session. The drink lands in the archived history session that
   * matches the pub + drinking-day of its timestamp; if none exists a fresh
   * archived session is created. Returns the session the drink landed in (so the
   * caller can sync the right visit). Used when a backdated timestamp would
   * otherwise roll over and clobber the active evening.
   */
  addBackdatedDrink: (pub: TallyPub, beer: TallyBeerInput) => TallySession;
  /**
   * Remove the most recently counted drink from the current session and return
   * its id (so the caller can also remove the queued payload). Returns null when
   * there is nothing to undo. Empties the session object if it was the last
   * drink (the pub stays pinned by the UI, not by the store).
   */
  undoLast: (expectedId?: string) => string | null;
  /**
   * Remove a specific drink (by id) from the current session, wherever it sits
   * in the list — used by the per-beer minus button, where the beer being
   * decremented is not necessarily the most recently counted one. Returns the
   * removed id, or null when no drink matched. A no-op on the empty session.
   */
  removeDrink: (id: string) => string | null;
  /**
   * Remove a specific drink from the selected evening, including archived
   * history sessions. Empty archived evenings are dropped; an empty current
   * session remains pinned until normal counter/session cleanup.
   */
  removeDrinkFromSession: (startedAt: string, drinkId: string) => RemovedDrinkResult | null;
  /** Rename one logged beer in the selected evening. Used for typo fixes. */
  updateDrinkNameInSession: (startedAt: string, drinkId: string, beerName: string) => boolean;
  /** Mark a drink as no longer queued, so the UI does not offer a local-only undo. */
  markDrinkSynced: (id: string) => void;
  /**
   * Close the current session explicitly, archiving it into history with the
   * given reason ('manual' for the user's "Dopito", 'timeout' for the idle
   * sweeper). A no-op on an empty/absent session — except it clears an empty
   * pinned session object so the counter resets cleanly.
   */
  archiveCurrent: (reason: ArchivedReason) => void;
  /**
   * Auto-complete the current session IFF it has gone idle (no drink within
   * IDLE_TIMEOUT_MS). Archives it with reason 'timeout' so it stays resumable.
   * Returns true when it archived. Safe to call on launch/foreground.
   */
  maybeAutoArchive: (nowMs?: number) => boolean;
  /**
   * Bring the most recently auto-completed evening back to `current` so counting
   * continues the SAME session (same clientId → same backend visit). Only the
   * newest history entry qualifies, and only when it was archived by timeout,
   * sits at `pubKey`, and is still the same drinking day. Returns true on resume.
   */
  resumeLast: (pubKey: string, nowMs?: number) => boolean;
  /** Wipe the current session AND history (e.g. a "start over" affordance). */
  reset: () => void;
}

/** The drinking-day key for an instant: local date shifted back by the cutoff.
 *  Returns `YYYY-MM-DD` in device-local time. Exported for tests. */
export function drinkingDayKey(at: Date): string {
  const shifted = new Date(at.getTime() - DAY_CUTOFF_HOURS * 60 * 60 * 1000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const d = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True when a new drink at `at` belongs to a different session than `session`
 *  (different pub or a rolled-over drinking day). Exported for tests. */
export function shouldStartNewSession(
  session: TallySession | null,
  pubKey: string,
  at: Date,
): boolean {
  if (!session) return true;
  if (session.pubKey !== pubKey) return true;
  return drinkingDayKey(new Date(session.startedAt)) !== drinkingDayKey(at);
}

/**
 * Routing predicate for a backdated drink: true when its timestamp belongs to an
 * EARLIER drinking day than `now` — a genuinely past evening that must be filed
 * into history (via addBackdatedDrink) rather than started or appended as the
 * live session. Same-drinking-day backdates ("před hodinou") route through the
 * normal addDrink path. Independent of whether a `current` session exists — a
 * backdate to yesterday with no live session must still NOT become `current`.
 * Pure + exported for unit tests.
 */
export function isPastEveningBackdate(at: string, now: Date = new Date()): boolean {
  return drinkingDayKey(new Date(at)) !== drinkingDayKey(now);
}

/** Order evenings newest-first by start time. Backdated drinks can insert an
 *  older evening into history, so the newest-first invariant must be re-sorted
 *  rather than assumed from front-insertion. */
function sortSessionsNewestFirst(sessions: TallySession[]): TallySession[] {
  return sessions.slice().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

/** Ensure a persisted session carries a stable `clientId`, minting one when an
 *  older build wrote it without (v0 → v1). Exported for unit tests. */
function ensureSessionClientId(session: TallySession | null): TallySession | null {
  if (!session) return null;
  if (typeof session.clientId === 'string' && session.clientId) return session;
  return { ...session, clientId: generateUuidV4() };
}

/**
 * Migrate persisted tally state to the current shape. v0 sessions predate the
 * per-session `clientId` used as the /v1/pub-visits idempotency key, so v1
 * backfills one for the current session and every archived session. Exported so
 * the migration is unit-testable in isolation.
 */
export function migrateTally(persisted: unknown, version: number): TallyState {
  const base = (persisted ?? {}) as Partial<TallyState>;
  if (version >= 1) return base as TallyState;

  const current = ensureSessionClientId((base.current as TallySession | null) ?? null);
  const history = Array.isArray(base.history)
    ? (base.history as TallySession[])
        .map((session) => ensureSessionClientId(session))
        .filter((session): session is TallySession => session != null)
    : [];

  return { ...(base as TallyState), current, history };
}

export const useTallyStore = create<TallyState>()(
  persist(
    (set) => ({
      current: null,
      history: [],

      addDrink: (pub, beer) =>
        set((state) => {
          const at = beer.at ?? new Date().toISOString();
          const atDate = new Date(at);
          const drink: TallyDrink = {
            id: beer.id,
            beerName: beer.beerName,
            at,
            syncStatus: 'pending',
          };
          if (typeof beer.priceCzk === 'number') drink.priceCzk = beer.priceCzk;
          if (beer.drinkType && beer.drinkType !== 'beer') drink.drinkType = beer.drinkType;
          if (typeof beer.volumeMl === 'number') drink.volumeMl = beer.volumeMl;
          if (beer.servingType && beer.servingType !== 'unknown') drink.servingType = beer.servingType;

          const rollover = shouldStartNewSession(state.current, pub.pubKey, atDate);

          if (rollover) {
            // Archive a non-empty current session before opening a fresh one,
            // tagging WHY it closed (a different pub vs the drinking day rolling
            // over) so it is distinguishable from a resumable timeout archive.
            const reason: ArchivedReason =
              state.current && state.current.pubKey !== pub.pubKey ? 'pub-change' : 'day-rollover';
            const history =
              state.current && state.current.drinks.length > 0
                ? [{ ...state.current, archivedReason: reason }, ...state.history].slice(0, MAX_HISTORY)
                : state.history;
            return {
              current: {
                clientId: generateUuidV4(),
                pubKey: pub.pubKey,
                pubName: pub.pubName,
                ...(pub.pubCity ? { pubCity: pub.pubCity } : {}),
                ...(pub.pubExternalId ? { pubExternalId: pub.pubExternalId } : {}),
                ...(pub.placeContext && pub.placeContext !== 'pub'
                  ? { placeContext: pub.placeContext }
                  : {}),
                startedAt: at,
                drinks: [drink],
              },
              history,
            };
          }

          // Same session → append. Refresh the pub name in case it was edited.
          // A same-day backdate can predate the session start — keep startedAt
          // as the evening's earliest drink (mirrors addBackdatedDrink).
          const session = state.current as TallySession;
          const startedAt =
            Date.parse(at) < Date.parse(session.startedAt) ? at : session.startedAt;
          return {
            current: {
              ...session,
              pubName: pub.pubName,
              ...(pub.pubCity ? { pubCity: pub.pubCity } : {}),
              ...(pub.pubExternalId ? { pubExternalId: pub.pubExternalId } : {}),
              startedAt,
              drinks: [...session.drinks, drink],
            },
          };
        }),

      addBackdatedDrink: (pub, beer) => {
        const box: { session: TallySession | null } = { session: null };
        set((state) => {
          const at = beer.at ?? new Date().toISOString();
          const atDate = new Date(at);
          const drink: TallyDrink = {
            id: beer.id,
            beerName: beer.beerName,
            at,
            syncStatus: 'pending',
          };
          if (typeof beer.priceCzk === 'number') drink.priceCzk = beer.priceCzk;
          if (beer.drinkType && beer.drinkType !== 'beer') drink.drinkType = beer.drinkType;
          if (typeof beer.volumeMl === 'number') drink.volumeMl = beer.volumeMl;
          if (beer.servingType && beer.servingType !== 'unknown') drink.servingType = beer.servingType;

          const dayKey = drinkingDayKey(atDate);
          // Append to the archived evening at the same pub + drinking day, if any.
          let matched = false;
          const history = state.history.map((session) => {
            if (matched || session.pubKey !== pub.pubKey) return session;
            if (drinkingDayKey(new Date(session.startedAt)) !== dayKey) return session;
            matched = true;
            // Keep startedAt as the evening's earliest drink.
            const startedAt =
              Date.parse(at) < Date.parse(session.startedAt) ? at : session.startedAt;
            const updated: TallySession = {
              ...session,
              pubName: pub.pubName,
              ...(pub.pubCity ? { pubCity: pub.pubCity } : {}),
              ...(pub.pubExternalId ? { pubExternalId: pub.pubExternalId } : {}),
              startedAt,
              drinks: [...session.drinks, drink],
            };
            box.session = updated;
            return updated;
          });

          if (matched) {
            return { history: sortSessionsNewestFirst(history) };
          }

          // No matching evening → open a fresh archived one for that night.
          const created: TallySession = {
            clientId: generateUuidV4(),
            pubKey: pub.pubKey,
            pubName: pub.pubName,
            ...(pub.pubCity ? { pubCity: pub.pubCity } : {}),
            ...(pub.pubExternalId ? { pubExternalId: pub.pubExternalId } : {}),
            ...(pub.placeContext && pub.placeContext !== 'pub'
              ? { placeContext: pub.placeContext }
              : {}),
            startedAt: at,
            drinks: [drink],
            archivedReason: 'manual',
          };
          box.session = created;
          return {
            history: sortSessionsNewestFirst([created, ...state.history]).slice(0, MAX_HISTORY),
          };
        });
        return box.session as TallySession;
      },

      undoLast: (expectedId) => {
        let removedId: string | null = null;
        set((state) => {
          if (!state.current || state.current.drinks.length === 0) return state;
          const drinks = state.current.drinks.slice();
          if (expectedId && drinks[drinks.length - 1]?.id !== expectedId) return state;
          const removed = drinks.pop();
          removedId = removed?.id ?? null;
          return { current: { ...state.current, drinks } };
        });
        return removedId;
      },

      removeDrink: (id) => {
        let removedId: string | null = null;
        set((state) => {
          if (!state.current) return state;
          const drinks = state.current.drinks.filter((drink) => {
            if (drink.id === id && removedId === null) {
              removedId = id;
              return false;
            }
            return true;
          });
          if (removedId === null) return state;
          return { current: { ...state.current, drinks } };
        });
        return removedId;
      },

      removeDrinkFromSession: (startedAt, drinkId) => {
        let result: RemovedDrinkResult | null = null;
        set((state) => {
          if (state.current?.startedAt === startedAt) {
            let removed = false;
            const drinks = state.current.drinks.filter((drink) => {
              if (!removed && drink.id === drinkId) {
                removed = true;
                return false;
              }
              return true;
            });
            if (!removed) return state;
            result = {
              drinkId,
              sessionClientId: state.current.clientId,
              remainingDrinks: drinks.length,
            };
            return { current: { ...state.current, drinks } };
          }

          let changed = false;
          const history = state.history.flatMap((session) => {
            if (session.startedAt !== startedAt) return [session];
            let removed = false;
            const drinks = session.drinks.filter((drink) => {
              if (!removed && drink.id === drinkId) {
                removed = true;
                return false;
              }
              return true;
            });
            if (!removed) return [session];
            changed = true;
            result = {
              drinkId,
              sessionClientId: session.clientId,
              remainingDrinks: drinks.length,
            };
            return drinks.length > 0 ? [{ ...session, drinks }] : [];
          });
          if (!changed) return state;
          return { history };
        });
        return result;
      },

      updateDrinkNameInSession: (startedAt, drinkId, beerName) => {
        const trimmed = beerName.trim();
        if (!trimmed) return false;
        let changed = false;
        set((state) => {
          if (state.current?.startedAt === startedAt) {
            const drinks = state.current.drinks.map((drink) => {
              if (drink.id !== drinkId) return drink;
              if (drink.beerName === trimmed) return drink;
              changed = true;
              return { ...drink, beerName: trimmed };
            });
            return changed ? { current: { ...state.current, drinks } } : state;
          }

          const history = state.history.map((session) => {
            if (session.startedAt !== startedAt) return session;
            const drinks = session.drinks.map((drink) => {
              if (drink.id !== drinkId) return drink;
              if (drink.beerName === trimmed) return drink;
              changed = true;
              return { ...drink, beerName: trimmed };
            });
            return changed ? { ...session, drinks } : session;
          });
          return changed ? { history } : state;
        });
        return changed;
      },

      markDrinkSynced: (id) =>
        set((state) => {
          if (!state.current) return state;
          let changed = false;
          const drinks = state.current.drinks.map((drink) => {
            if (drink.id !== id) return drink;
            changed = true;
            return { ...drink, syncStatus: 'sent' as const };
          });
          if (!changed) return state;
          return { current: { ...state.current, drinks } };
        }),

      archiveCurrent: (reason) =>
        set((state) => {
          if (!state.current) return state;
          // An empty pinned session is not an evening — just drop it.
          if (state.current.drinks.length === 0) return { current: null };
          const archived: TallySession = { ...state.current, archivedReason: reason };
          return { current: null, history: [archived, ...state.history].slice(0, MAX_HISTORY) };
        }),

      maybeAutoArchive: (nowMs = Date.now()) => {
        let archived = false;
        set((state) => {
          if (!state.current || state.current.drinks.length === 0) return state;
          if (nowMs - sessionLastActivityMs(state.current) < IDLE_TIMEOUT_MS) return state;
          archived = true;
          const arch: TallySession = { ...state.current, archivedReason: 'timeout' };
          return { current: null, history: [arch, ...state.history].slice(0, MAX_HISTORY) };
        });
        return archived;
      },

      resumeLast: (pubKey, nowMs = Date.now()) => {
        let resumed = false;
        set((state) => {
          // A live session takes priority — never clobber an in-progress evening.
          if (state.current && state.current.drinks.length > 0) return state;
          const last = state.history[0];
          if (!last || last.archivedReason !== 'timeout' || last.pubKey !== pubKey) return state;
          // Only the same drinking day: across the 04:00 cutoff it's a new evening,
          // and reopening it would make the next drink immediately roll it over.
          if (drinkingDayKey(new Date(last.startedAt)) !== drinkingDayKey(new Date(nowMs))) {
            return state;
          }
          resumed = true;
          const { archivedReason: _omit, ...restored } = last;
          return { current: restored, history: state.history.slice(1) };
        });
        return resumed;
      },

      reset: () =>
        set((state) => {
          // Wiping local evenings must also retract them from the backend. We
          // collect every session's clientId and enqueue a visit delete for each.
          // The delete helper is required lazily to avoid a static import cycle
          // (visitsSync imports this store); it is fire-and-forget + never throws.
          const sessions = state.current ? [state.current, ...state.history] : state.history;
          const clientIds = sessions
            .map((session) => session.clientId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
          if (clientIds.length > 0) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { deleteVisitByClientId } = require('@/data/visitsSync') as {
                deleteVisitByClientId: (clientId: string) => void;
              };
              for (const id of clientIds) deleteVisitByClientId(id);
            } catch {
              // Sync module unavailable (e.g. under a test harness) — local wipe
              // still proceeds; the backend reconciles on the next launch.
            }
          }
          return { current: null, history: [] };
        }),
    }),
    {
      name: 'na-pivo-tally',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ current: state.current, history: state.history }),
      migrate: migrateTally,
    },
  ),
);

/** Number of beer-category drinks. Legacy rows without a type are beer. */
export function sessionCount(session: TallySession | null): number {
  return session?.drinks.filter((drink) => normalizeDrinkType(drink.drinkType) === 'beer').length ?? 0;
}

/** All logged items, used for session lifecycle rather than beer stats. */
export function sessionDrinkCount(session: TallySession | null): number {
  return session?.drinks.length ?? 0;
}

export function sessionDrinkTypeCounts(session: TallySession | null): Record<DrinkType, number> {
  const counts: Record<DrinkType, number> = { beer: 0, soft_drink: 0, shot: 0, wine: 0 };
  for (const drink of session?.drinks ?? []) counts[normalizeDrinkType(drink.drinkType)] += 1;
  return counts;
}

/** Total spent (CZK) in the current session. Drinks without a price (possible
 *  outside a pub) simply don't add — unknown stays unknown, never 0. */
export function sessionTotalCzk(session: TallySession | null): number {
  return (
    session?.drinks.reduce(
      (sum, d) => sum + (typeof d.priceCzk === 'number' ? d.priceCzk : 0),
      0,
    ) ?? 0
  );
}

/** The session's place context, defaulting persisted pre-feature rows to pub. */
export function sessionPlaceContext(session: TallySession | null): PlaceContext {
  return normalizePlaceContext(session?.placeContext);
}

/**
 * All drinking evenings, newest-first, as a single list — the read model behind
 * "Moje piva". The live `current` session is NOT in `history` until it rolls
 * over, so we prepend it (only when it actually holds drinks; an empty pinned
 * session is not an evening). Pure + non-mutating so the screen and tests can
 * rely on it without touching counter behavior.
 */
export function allSessionsNewestFirst(
  current: TallySession | null,
  history: TallySession[],
): TallySession[] {
  if (current && current.drinks.length > 0) return [current, ...history];
  return history;
}

/** Find an evening by its `startedAt` (the stable per-session identity used for
 *  routing to a detail screen). Searches the live session first, then history. */
export function findSessionByStart(
  current: TallySession | null,
  history: TallySession[],
  startedAt: string,
): TallySession | null {
  return allSessionsNewestFirst(current, history).find((s) => s.startedAt === startedAt) ?? null;
}

/** Epoch-ms of the session's last activity: the latest counted beer, falling
 *  back to the session start when (defensively) it holds no drinks. */
export function sessionLastActivityMs(session: TallySession): number {
  let maxMs = Date.parse(session.startedAt);
  for (const drink of session.drinks) {
    const ms = Date.parse(drink.at);
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  return Number.isFinite(maxMs) ? maxMs : 0;
}

/**
 * The evening the counter can offer to resume at `pubKey`, or null. It is the
 * newest history session, but only when it was auto-completed by timeout, sits
 * at the same pub, and falls on the current drinking day — i.e. "you stepped
 * away and came back to the same place tonight". A live session suppresses it.
 */
export function resumableSession(
  current: TallySession | null,
  history: TallySession[],
  pubKey: string,
  nowMs: number = Date.now(),
): TallySession | null {
  if (current && current.drinks.length > 0) return null;
  const last = history[0];
  if (!last || last.archivedReason !== 'timeout' || last.pubKey !== pubKey) return null;
  if (drinkingDayKey(new Date(last.startedAt)) !== drinkingDayKey(new Date(nowMs))) return null;
  return last;
}

/** Per-beer counts in the current session, keyed by normalized name + volume —
 *  used to show a "×3" badge on each menu card. Key shape: `name|volume`. */
export function sessionBeerCounts(session: TallySession | null): Map<string, number> {
  const counts = new Map<string, number>();
  if (!session) return counts;
  for (const drink of session.drinks) {
    if (normalizeDrinkType(drink.drinkType) !== 'beer') continue;
    const key = `${drink.beerName.trim().toLowerCase()}|${drink.volumeMl ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
