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
 *   photos   `livePartyStore` — still local; the real ones are `BeerPhoto`
 *
 * Photos are the last mocked part of a running night, and they are passed in
 * rather than special-cased, so replacing them is a change of source and not a
 * change of shape.
 */

import React from 'react';

import { useAccountStore } from '@/stores/accountStore';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { usePartyGamesStore } from '@/stores/partyGamesStore';
import { useTallyStore } from '@/stores/tallyStore';
import { buildNightRecord, tintFor } from '@/party/nightBuilder';
import type { NightGame, NightPhoto, NightRecord, NightStop } from '@/party/nightRecord';

/** Whoever is holding the phone, before an account id is known. */
const ME_FALLBACK = 'me';

export function useNightRecord(): NightRecord {
  const session = useTallyStore((s) => s.current);
  const evening = usePartyEveningStore((s) => s.evening);
  const accountId = useAccountStore((s) => s.session?.accountId);

  const live = useLivePartyStore((s) => s.live);
  const pubName = useLivePartyStore((s) => s.pubName);
  const startedAt = useLivePartyStore((s) => s.startedAt);
  const guests = useLivePartyStore((s) => s.people);
  const games = useLivePartyStore((s) => s.games);
  const log = useLivePartyStore((s) => s.log);
  const sharedGames = usePartyGamesStore((s) => s.games);
  const sharedEvents = usePartyGamesStore((s) => s.events);

  // The account id matters: it is how a drink of mine is told apart from the
  // copy the server sends back. Without it the two would be counted twice.
  const meId = accountId ?? ME_FALLBACK;

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
    const opened = startedAt ?? (session ? new Date(session.startedAt).getTime() : 0);
    const openedIso = new Date(opened).toISOString();

    // One stop for now — where you are. The walk arrives with `PubVisit`.
    const stops: NightStop[] = live
      ? [
          {
            id: session?.pubKey ?? 'stop',
            pubName: session?.pubName ?? pubName,
            cacheKey: session?.pubKey ?? null,
            arrivedAt: openedIso,
          },
        ]
      : [];

    const nightGames: NightGame[] = games.map((game) => ({
      key: game.key,
      name: game.name,
      // `at` is minutes into the evening in the local store; the record speaks
      // in instants, because a recap read tomorrow has no "now" to count from.
      startedAt: new Date(opened + game.at * 60000).toISOString(),
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

    const photos: NightPhoto[] = log
      .filter((event) => event.kind === 'photo' && event.photo)
      .map((event) => ({
        id: event.id,
        url: event.photo as string,
        at: new Date(event.at).toISOString(),
        by: event.by === 'Ty' ? meId : event.by,
      }));

    // Games somebody ELSE put on the table. Keyed by catalogue key, because
    // that is what a thread row launches — and the same game twice at one table
    // at the same moment is not a case worth splitting rows over.
    const local = new Set(nightGames.map((game) => game.key));
    for (const shared of sharedGames) {
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
      evening,
      session,
      meId,
      stops,
      games: nightGames,
      photos,
      ...(opened > 0 ? { startedAt: openedIso } : {}),
    });

    // Guests: people at the table who are not in the shared evening — either
    // there is no evening, or they have no phone in it. They carry no drinks,
    // because nobody logged any for them, and inventing some would put numbers
    // in a scoreboard that nothing backs up.
    const known = new Set(record.people.map((person) => person.id));
    const extra = guests
      .filter((guest) => !known.has(guest.id))
      .map((guest) => ({
        id: guest.id,
        name: guest.name,
        avatarUrl: null,
        tint: guest.tint || tintFor(guest.id),
      }));

    return extra.length > 0 ? { ...record, people: [...record.people, ...extra] } : record;
  }, [evening, session, meId, live, pubName, startedAt, games, log, guests, sharedGames, finishedResults]);
}
