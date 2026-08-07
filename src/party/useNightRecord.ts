/**
 * Dnešní večer, jak ho vidí obrazovky.
 *
 * One hook, so the hub, the glass bar, the game screen and the finish screen all
 * read the SAME night. Before this each of them held its own copy and they could
 * disagree about how many beers there had been — which is exactly the bug that
 * makes a shared table not worth trusting.
 *
 * Where the parts come from is `buildNightRecord`'s business
 * (`src/party/nightBuilder.ts`). This only wires it to the stores:
 *
 *   me       `tallyStore` — the counter, the diary's own truth
 *   others   `partyEveningStore` — the shared evening, when there is one
 *   games    `livePartyStore` for the ones YOU put down, plus `partyGamesStore`
 *            for the ones somebody else did
 *   photos   persisted `beerPhotosStore`, filtered by the 04:00 drinking day
 */

import React from 'react';

import { useAccountStore } from '@/stores/accountStore';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { usePartyGamesStore } from '@/stores/partyGamesStore';
import { drinkingDayKey, useTallyStore, type TallySession } from '@/stores/tallyStore';
import {
  beerPhotosForDrinkingDay,
  beerPhotoUri,
  useBeerPhotosStore,
} from '@/stores/beerPhotosStore';
import { sessionsOfNight } from '@/vycep/nightModel';
import { buildNightRecord, nightStopsFromSessions, tintFor } from '@/party/nightBuilder';
import type { NightGame, NightPhoto, NightRecord, NightStop } from '@/party/nightRecord';

/** Whoever is holding the phone, before an account id is known. */
const ME_FALLBACK = 'me';

/** Accept `night-YYYY-MM-DD`, a bare drinking day, session id or startedAt. */
export function resolveNightDayKey(
  nightKey: string | undefined,
  sessions: TallySession[],
): string | null {
  if (!nightKey) return null;
  const direct = nightKey.startsWith('night-') ? nightKey.slice(6) : nightKey;
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const matched = sessions.find(
    (session) => session.clientId === nightKey || session.startedAt === nightKey,
  );
  if (matched) return drinkingDayKey(new Date(matched.startedAt));
  const parsed = new Date(nightKey);
  return Number.isFinite(parsed.getTime()) ? drinkingDayKey(parsed) : null;
}

function latestActivity(sessions: TallySession[]): string | null {
  let latest: string | null = null;
  for (const session of sessions) {
    const candidates = [session.startedAt, ...session.drinks.map((drink) => drink.at)];
    for (const candidate of candidates) {
      if (!latest || candidate > latest) latest = candidate;
    }
  }
  return latest;
}

export function useNightRecord(nightKey?: string): NightRecord {
  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const evening = usePartyEveningStore((s) => s.evening);
  const accountId = useAccountStore((s) => s.session?.accountId);

  const live = useLivePartyStore((s) => s.live);
  const startedAt = useLivePartyStore((s) => s.startedAt);
  const guests = useLivePartyStore((s) => s.people);
  const games = useLivePartyStore((s) => s.games);
  const beerPhotos = useBeerPhotosStore((s) => s.photos);
  const sharedGames = usePartyGamesStore((s) => s.games);
  const sharedEvents = usePartyGamesStore((s) => s.events);

  // The account id matters: it is how a drink of mine is told apart from the
  // copy the server sends back. Without it the two would be counted twice.
  const meId = accountId ?? ME_FALLBACK;
  const allSessions = React.useMemo(
    () => [...(current ? [current] : []), ...history],
    [current, history],
  );
  const localPartyDay = React.useMemo(() => {
    if (startedAt !== null) return drinkingDayKey(new Date(startedAt));
    if (current) return drinkingDayKey(new Date(current.startedAt));
    return null;
  }, [startedAt, current]);
  const requestedDay = React.useMemo(
    () => resolveNightDayKey(nightKey, allSessions),
    [nightKey, allSessions],
  );
  const dayKey =
    requestedDay ??
    localPartyDay ??
    (allSessions[0]
      ? drinkingDayKey(new Date(allSessions[0].startedAt))
      : drinkingDayKey(new Date()));
  const nightSessions = React.useMemo(
    () => sessionsOfNight(current, history, dayKey),
    [current, history, dayKey],
  );
  const hasLocalPartyData = dayKey === localPartyDay;
  const isLiveDay = live && hasLocalPartyData;

  /** What each shared game said when it ended. Last `finish` wins — a game only
   *  ends once, and a resend of the same event carries the same result. */
  const finishedResults = React.useMemo(() => {
    const byGame = new Map<string, NonNullable<NightGame['result']>>();
    for (const event of sharedEvents) {
      if (event.kind !== 'finish') continue;
      const winner = event.payload.winner;
      const paying = event.payload.paying;
      const scores = Array.isArray(event.payload.scores) ? event.payload.scores : [];
      byGame.set(event.gameId, {
        winner: typeof winner === 'string' ? winner : null,
        ...(typeof paying === 'string' ? { paying } : {}),
        scores: scores.flatMap((row) => {
          const entry = row as { name?: unknown; score?: unknown };
          return typeof entry?.name === 'string' && typeof entry?.score === 'number'
            ? [{ name: entry.name, score: entry.score }]
            : [];
        }),
      });
    }
    return byGame;
  }, [sharedEvents]);

  return React.useMemo(() => {
    // No `Date.now()` here: a night that has not started has no start, and the
    // builder already knows what to do with that. (It is also impure, and the
    // lint rule cannot tell a memo from a render.)
    const firstSession = nightSessions[0] ?? null;
    const lastSession = nightSessions[nightSessions.length - 1] ?? null;
    const opened = isLiveDay
      ? firstSession
        ? new Date(firstSession.startedAt).getTime()
        : startedAt ?? 0
      : firstSession
        ? new Date(firstSession.startedAt).getTime()
        : new Date(`${dayKey}T04:00:00`).getTime();
    const openedIso = new Date(opened).toISOString();

    const stops: NightStop[] = nightStopsFromSessions(nightSessions);

    const nightGames: NightGame[] = (hasLocalPartyData ? games : []).map((game) => ({
      key: game.key,
      name: game.name,
      // Current entries use epoch ms. Keep compatibility with early persisted
      // mock rows that stored minutes from the start.
      startedAt: new Date(
        game.at > 10_000_000_000 ? game.at : opened + game.at * 60000,
      ).toISOString(),
      ...(game.result
        ? {
            result: {
              winner: game.result.winner,
              ...(game.result.paying !== undefined ? { paying: game.result.paying } : {}),
              scores: game.result.scores,
            },
          }
        : {}),
    }));

    const photos: NightPhoto[] = beerPhotosForDrinkingDay(beerPhotos, dayKey).flatMap((photo) => {
      const url = beerPhotoUri(photo);
      return url
        ? [{ id: photo.id ?? photo.clientId, url, at: photo.takenAt, by: meId }]
        : [];
    });

    // Games somebody ELSE put on the table. Keyed by catalogue key, because
    // that is what a thread row launches — and the same game twice at one table
    // at the same moment is not a case worth splitting rows over.
    const local = new Set(nightGames.map((game) => game.key));
    for (const shared of isLiveDay ? sharedGames : []) {
      if (local.has(shared.catalogKey)) continue;
      nightGames.push({
        key: shared.catalogKey,
        name: shared.name,
        startedAt: shared.startedAt,
        // The result as the game STATED it, not one re-derived here. Two phones
        // recomputing an outcome from partial events is how a table ends up
        // arguing about who is paying.
        ...(finishedResults.get(shared.id) ? { result: finishedResults.get(shared.id)! } : {}),
      });
    }

    const record = buildNightRecord({
      evening: isLiveDay ? evening : null,
      session: lastSession,
      sessions: nightSessions,
      meId,
      stops,
      games: nightGames,
      photos,
      startedAt: openedIso,
      endedAt: isLiveDay ? null : latestActivity(nightSessions) ?? openedIso,
    });

    // Guests: people at the table who are not in the shared evening — either
    // there is no evening, or they have no phone in it. They carry no drinks,
    // because nobody logged any for them, and inventing some would put numbers
    // in a scoreboard that nothing backs up.
    const known = new Set(record.people.map((person) => person.id));
    const extra = (hasLocalPartyData ? guests : [])
      .filter((guest) => !known.has(guest.id))
      .map((guest) => ({
        id: guest.id,
        name: guest.name,
        avatarUrl: guest.avatarUrl ?? null,
        tint: guest.tint || tintFor(guest.id),
      }));

    return {
      ...record,
      id: `night-${dayKey}`,
      ...(extra.length > 0 ? { people: [...record.people, ...extra] } : {}),
    };
  }, [
    evening,
    meId,
    isLiveDay,
    hasLocalPartyData,
    startedAt,
    games,
    guests,
    sharedGames,
    finishedResults,
    nightSessions,
    beerPhotos,
    dayKey,
  ]);
}
