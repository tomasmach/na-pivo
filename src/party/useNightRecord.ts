/**
 * The current shared evening as one release-grade record.
 *
 * The server's private `/record` endpoint is canonical for the table: members,
 * everybody else's drinks, visits, games and photos. This phone's tally stays
 * in the result immediately, so counting still works offline and a queued drink
 * never disappears while the server catches up. The last good server record is
 * cached privately for the finish → recap transition, cold restart and cellar
 * signal. With no local evening, bounded server history recovers the latest
 * ended table on another signed-in device.
 */

import React from 'react';

import {
  fetchPartyEveningHistory,
  fetchPartyNightRecord,
  type PartyEvening,
} from '@/data/partyClient';
import { useAccountStore } from '@/stores/accountStore';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { usePartyGamesStore } from '@/stores/partyGamesStore';
import type { PartyGame } from '@/data/partyGamesClient';
import { normalizePubNameForIdentity } from '@/data/pubIdentity';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { drinkingDayKey, useTallyStore, type TallySession } from '@/stores/tallyStore';
import { buildNightRecord, fallbackPlayerName } from '@/party/nightBuilder';
import {
  loadLatestNightRecordCache,
  loadNightRecordCache,
  readNightRecordCache,
  writeNightRecordCache,
} from '@/party/nightRecordCache';
import type { NightGame, NightPhoto, NightRecord, NightStop } from '@/party/nightRecord';

const ME_FALLBACK = 'me';
const REFRESH_MS = 10_000;

export type NightRecordRecoveryState = 'loading' | 'ready' | 'empty' | 'unavailable';

interface NightRecordOptions {
  recoverLatestEnded?: boolean;
  /** When false (e.g. a background route), no remote cache load or refresh runs. */
  pollingEnabled?: boolean;
  onRecoveryStateChange?: (state: NightRecordRecoveryState) => void;
}

export function mergeNightGames(
  localGames: NightGame[],
  sharedGames: PartyGame[],
  finishedResults: ReadonlyMap<string, NonNullable<NightGame['result']>>,
): NightGame[] {
  const sharedByKey = new Map(sharedGames.map((game) => [game.catalogKey, game]));
  const games = localGames.map((game) => {
    const shared = sharedByKey.get(game.key);
    const sharedResult = shared ? finishedResults.get(shared.id) : undefined;
    return {
      ...game,
      // Provenance follows the real starter on the server, even when this
      // phone is the one merging the row — never the merger.
      ...(shared?.startedBy ? { by: shared.startedBy.id } : {}),
      ...(sharedResult ? { result: sharedResult } : {}),
    };
  });
  const known = new Set(games.map((game) => game.key));
  for (const shared of sharedGames) {
    if (known.has(shared.catalogKey)) continue;
    games.push({
      key: shared.catalogKey,
      name: shared.name,
      by: shared.startedBy.id,
      startedAt: shared.startedAt,
      ...(finishedResults.get(shared.id) ? { result: finishedResults.get(shared.id)! } : {}),
    });
  }
  return games;
}

/** The epoch placeholder is an internal builder fallback, never recap content. */
export function hasRenderableNightRecord(night: NightRecord): boolean {
  const startedAt = Date.parse(night.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
  return Boolean(
    night.code ||
    night.endedAt ||
    night.stops.length ||
    night.drinks.length ||
    night.games.length ||
    night.photos.length,
  );
}

/** Freeze the fully merged record before finish mutates membership/local stores. */
export function rememberNightRecord(
  record: NightRecord,
  accountId: string | null | undefined,
): Promise<void> {
  return writeNightRecordCache(accountId, record);
}

function mergeByKey<T>(remote: T[], local: T[], keyOf: (item: T) => string): T[] {
  const merged = new Map(remote.map((item) => [keyOf(item), item]));
  for (const item of local) merged.set(keyOf(item), item);
  return [...merged.values()];
}

function earliestStartedAt(values: (string | null | undefined)[]): string | null {
  let earliest: { value: string; time: number } | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = Date.parse(value);
    // Epoch is the builder's internal empty-record sentinel, not a real night.
    if (!Number.isFinite(time) || time <= 0) continue;
    if (!earliest || time < earliest.time) earliest = { value, time };
  }
  return earliest?.value ?? null;
}

function canonicalStopForPlaceholder(
  remoteStops: NightStop[],
  placeholder: NightStop,
): NightStop | undefined {
  if (placeholder.cacheKey && !isContextPubKey(placeholder.cacheKey)) return undefined;
  const name = normalizePubNameForIdentity(placeholder.pubName);
  if (!name) return undefined;

  const candidates = remoteStops.filter(
    (candidate) =>
      candidate.cacheKey != null &&
      !isContextPubKey(candidate.cacheKey) &&
      normalizePubNameForIdentity(candidate.pubName) === name,
  );
  if (new Set(candidates.map((candidate) => candidate.cacheKey)).size !== 1) return undefined;

  const placeholderAt = Date.parse(placeholder.arrivedAt);
  if (!Number.isFinite(placeholderAt)) return candidates[0];
  return candidates.reduce((closest, candidate) => {
    const closestDistance = Math.abs(Date.parse(closest.arrivedAt) - placeholderAt);
    const candidateDistance = Math.abs(Date.parse(candidate.arrivedAt) - placeholderAt);
    return candidateDistance < closestDistance ? candidate : closest;
  });
}

/** Exported for a focused no-double-count regression test. */
export function mergeNightRecords(remote: NightRecord, local: NightRecord): NightRecord {
  const meId = local.people[0]?.id;
  const localPeople = new Map(local.people.map((person) => [person.id, person]));
  // The server record is authoritative even when its roster is empty: a stale
  // local copy never restores omitted peers (privacy-hidden, blocked, deleted
  // or already gone). At most this account's own provable identity survives,
  // so an offline table still has a "you".
  const peopleById = new Map(
    remote.people.map((person) => {
      const localPerson = localPeople.get(person.id);
      const isMe = person.id === meId;
      return [
        person.id,
        {
          ...localPerson,
          ...person,
          name:
            person.name.trim() ||
            localPerson?.name.trim() ||
            fallbackPlayerName(person.id),
          avatarUrl: person.avatarUrl ?? localPerson?.avatarUrl ?? null,
          tint: isMe ? (localPerson?.tint ?? person.tint) : person.tint,
        },
      ];
    }),
  );
  if (meId && !peopleById.has(meId)) {
    const localSelf = localPeople.get(meId);
    if (localSelf) peopleById.set(meId, localSelf);
  }
  const people = [...peopleById.values()].sort((left, right) => {
    if (left.id === meId) return -1;
    if (right.id === meId) return 1;
    return 0;
  });
  const remoteStopsByLocalId = new Map<string, NightStop>();
  for (const stop of remote.stops) {
    // Server stop ids deliberately include the PubVisit client id. That lets an
    // optimistic local visit become the same stop as soon as it comes back.
    const clientId = stop.id.split(':').at(-1);
    if (clientId) remoteStopsByLocalId.set(clientId, stop);
  }
  const stopAliases = new Map<string, string>();
  // Only this account's own pending stops survive the merge; rows attributed
  // to an omitted peer never come back from the local copy. Legacy local rows
  // without an owner were recorded by this phone.
  const pendingStops = local.stops.filter((stop) => {
    if (meId && stop.by != null && stop.by !== meId) return false;
    const exact = remoteStopsByLocalId.get(stop.id);
    const equivalent =
      exact ??
      remote.stops.find(
        (candidate) =>
          candidate.by === stop.by &&
          candidate.cacheKey === stop.cacheKey &&
          candidate.arrivedAt === stop.arrivedAt,
      ) ??
      canonicalStopForPlaceholder(remote.stops, stop);
    if (!equivalent) return true;
    stopAliases.set(stop.id, equivalent.id);
    return false;
  });
  const stops = [...remote.stops, ...pendingStops].sort((a, b) =>
    a.arrivedAt.localeCompare(b.arrivedAt),
  );
  const optimisticDrinks = meId ? local.drinks.filter((drink) => drink.by === meId) : [];
  const remoteDrinks = new Map(remote.drinks.map((drink) => [drink.id, drink]));
  const mergedOptimisticDrinks = optimisticDrinks.map((drink) => {
    const serverTwin = remoteDrinks.get(drink.id);
    return {
      ...serverTwin,
      ...drink,
      // The server has the canonical visit id. Preserve optimistic names and
      // timestamps, but never leave a drink pointing at a vanished local stop.
      stopId:
        serverTwin?.stopId ??
        (drink.stopId ? (stopAliases.get(drink.stopId) ?? drink.stopId) : null),
    };
  });
  const games = new Map(remote.games.map((game) => [game.key, game]));
  // Same owner rule as drinks and photos: only this account's own unsynced
  // games (and legacy by-less rows recorded by this phone) merge over the
  // authoritative server set; an omitted peer's local-only game never returns.
  for (const localGame of local.games.filter(
    (game) => !meId || game.by == null || game.by === meId,
  )) {
    const serverGame = games.get(localGame.key);
    games.set(localGame.key, {
      ...serverGame,
      ...localGame,
      ...((localGame.result ?? serverGame?.result)
        ? { result: localGame.result ?? serverGame?.result }
        : {}),
    });
  }
  const startedAt =
    earliestStartedAt([remote.startedAt, local.startedAt]) ?? remote.startedAt;
  return {
    ...remote,
    // A local drinking day may already contain earlier sittings than the table
    // or cached record. They are part of the same recap, so its clock must span
    // the whole crawl rather than restarting at the latest pub.
    startedAt,
    people,
    stops,
    // Diary client ids are the wire ids, so the optimistic local row replaces
    // its server twin instead of adding a second beer.
    drinks: mergeByKey(remote.drinks, mergedOptimisticDrinks, (drink) => drink.id).sort((a, b) =>
      a.at.localeCompare(b.at),
    ),
    games: [...games.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    // Same owner rule as drinks: only this account's own unsynced photos are
    // merged over the authoritative server set.
    photos: mergeByKey(
      remote.photos,
      local.photos.filter((photo) => photo.by === meId),
      (photo) => photo.id,
    ).sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export function sessionsForRecord(
  current: TallySession | null,
  history: TallySession[],
  startedAt: string | undefined,
): TallySession[] {
  const anchor = startedAt ?? current?.startedAt;
  if (!anchor || !Number.isFinite(Date.parse(anchor))) return [];
  const day = drinkingDayKey(new Date(anchor));
  const seenSessions = new Set<string>();
  const candidates = current ? [current, ...history] : history;
  const sessions: TallySession[] = [];

  for (const session of candidates) {
    if (!Number.isFinite(Date.parse(session.startedAt))) continue;
    if (drinkingDayKey(new Date(session.startedAt)) !== day) continue;
    // A resumed session can transiently exist in both buckets while persisted
    // state settles. Prefer `current` (it is first) and never draw its stop or
    // drinks twice.
    if (seenSessions.has(session.clientId)) continue;
    seenSessions.add(session.clientId);

    const seenDrinks = new Set<string>();
    const drinks = session.drinks.filter((drink) => {
      if (seenDrinks.has(drink.id)) return false;
      seenDrinks.add(drink.id);
      return true;
    });
    sessions.push(drinks.length === session.drinks.length ? session : { ...session, drinks });
  }

  return sessions.sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.clientId.localeCompare(right.clientId),
  );
}

/**
 * A shared table may start after today's personal counter did. Only drinks
 * logged while this account was actually sitting at this table belong in its
 * live total and recap; earlier same-day drinks stay in the private diary.
 *
 * Privacy beats completeness: without evidence of when this account sat down
 * (or that it created the table), nothing local is shared — the canonical
 * server record still carries everybody's tagged drinks.
 */
export function sessionsForSharedMembership(
  sessions: TallySession[],
  evening: PartyEvening | null,
  meId: string,
): TallySession[] {
  if (!evening) return sessions;
  const parseableEvents = evening.events.filter((event) =>
    Number.isFinite(Date.parse(event.at)),
  );
  // Rejoining updates the server membership's joined_at. When a richer event
  // timeline is available, process it in order. Every join deliberately
  // replaces the previous boundary: older shared drinks already come from the
  // canonical server record, while replaying all same-day local drinks could
  // expose beers logged privately between leave and rejoin.
  const membershipEvents = parseableEvents
    .filter(
      (event) =>
        event.account.id === meId &&
        (event.kind === 'joined' || event.kind === 'left'),
    )
    .sort(
      (left, right) =>
        Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
    );

  let boundaryIso: string;
  let leftAt: number | null = null;
  if (membershipEvents.length > 0) {
    boundaryIso = evening.startedAt;
    for (const event of membershipEvents) {
      if (event.kind === 'joined') {
        boundaryIso = event.at;
        leftAt = null;
      } else {
        leftAt = Date.parse(event.at);
      }
    }
  } else if (evening.isHost || evening.host?.id === meId) {
    // The host sat down before the evening existed, so the evening's own start
    // IS the join time.
    boundaryIso = evening.startedAt;
  } else {
    // No join/left row says when I sat down or stood up — whether the timeline
    // is missing entirely or just silent about me. Privacy beats completeness:
    // without evidence, this account contributes NO local sessions to the
    // shared night. The canonical server record still carries the tagged
    // drinks; a private beer logged before joining can never leak in here.
    const firstPresence = parseableEvents
      .filter((event) => event.account.id === meId)
      .map((event) => Date.parse(event.at))
      .sort((left, right) => left - right)
      .at(0);
    if (firstPresence === undefined) return [];
    boundaryIso = new Date(firstPresence).toISOString();
  }
  const boundary = Date.parse(boundaryIso);
  if (!Number.isFinite(boundary)) return sessions;

  return sessions.flatMap((session) => {
    const sessionStart = Date.parse(session.startedAt);
    const drinks = session.drinks.filter((drink) => {
      const at = Date.parse(drink.at);
      return Number.isFinite(at) && at >= boundary && (leftAt === null || at < leftAt);
    });
    if (
      Number.isFinite(sessionStart) &&
      sessionStart >= boundary &&
      (leftAt === null || sessionStart < leftAt)
    ) {
      return [{ ...session, drinks }];
    }
    if (drinks.length === 0) return [];
    return [{ ...session, startedAt: boundaryIso, drinks }];
  });
}

/** Kept for callers that need the latest sitting rather than the whole crawl. */
export function sessionForRecord(
  current: TallySession | null,
  history: TallySession[],
  startedAt: string | undefined,
): TallySession | null {
  return sessionsForRecord(current, history, startedAt).at(-1) ?? null;
}

export function stopsForSessions(sessions: TallySession[], meId: string): NightStop[] {
  const seen = new Set<string>();
  return sessions.flatMap((session) => {
    if (seen.has(session.clientId) || !session.pubName.trim()) return [];
    seen.add(session.clientId);
    return [
      {
        id: session.clientId,
        by: meId,
        pubName: session.pubName,
        cacheKey: session.pubKey || null,
        arrivedAt: session.startedAt,
      },
    ];
  });
}

export function useNightRecord(options: NightRecordOptions = {}): NightRecord {
  const recoverLatestEnded = options.recoverLatestEnded === true;
  const pollingEnabled = options.pollingEnabled !== false;
  const onRecoveryStateChange = options.onRecoveryStateChange;
  const currentSession = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const evening = usePartyEveningStore((state) => state.evening);
  const confirmedIdentity = usePartyEveningStore((state) => state.confirmedIdentity);
  const lastEvening = usePartyEveningStore((state) => state.lastEvening);
  const accountId = useAccountStore((state) => state.session?.accountId);

  const live = useLivePartyStore((state) => state.live);
  const pubName = useLivePartyStore((state) => state.pubName);
  const pubKey = useLivePartyStore((state) => state.pubKey);
  const partyPubVisits = useLivePartyStore((state) => state.pubVisits);
  const startedAt = useLivePartyStore((state) => state.startedAt);
  const localGames = useLivePartyStore((state) => state.games);
  const sharedGames = usePartyGamesStore((state) => state.games);
  const sharedEvents = usePartyGamesStore((state) => state.events);
  const allPhotos = useBeerPhotosStore((state) => state.photos);

  const targetEvening = evening ?? lastEvening;
  const code = targetEvening?.joinCode ?? confirmedIdentity?.joinCode ?? null;
  const initialCachedRecord = code && accountId ? readNightRecordCache(accountId, code) : null;
  const [remote, setRemote] = React.useState<{
    code: string | null;
    accountId: string;
    record: NightRecord;
  } | null>(() =>
    code && accountId && initialCachedRecord
      ? { code, accountId, record: initialCachedRecord }
      : null,
  );
  const accountRemote = remote && remote.accountId === accountId ? remote.record : null;
  const recoveredRecord =
    recoverLatestEnded &&
    !code &&
    !live &&
    accountRemote &&
    accountRemote.endedAt !== null
      ? accountRemote
      : null;
  const effectiveCode = code ?? recoveredRecord?.code ?? null;
  const meId = accountId ?? ME_FALLBACK;
  const localAnchor =
    targetEvening?.startedAt ??
    recoveredRecord?.startedAt ??
    (startedAt !== null ? new Date(startedAt).toISOString() : undefined);
  const daySessions = React.useMemo(
    () => sessionsForRecord(currentSession, history, localAnchor),
    [currentSession, history, localAnchor],
  );
  const sessions = React.useMemo(
    () => sessionsForSharedMembership(daySessions, targetEvening, meId),
    [daySessions, targetEvening, meId],
  );
  const session = sessions.at(-1) ?? null;
  const targetDrinkingDay = localAnchor
    ? drinkingDayKey(new Date(localAnchor))
    : sessions[0]
      ? drinkingDayKey(new Date(sessions[0].startedAt))
      : null;

  const finishedResults = React.useMemo(() => {
    const byGame = new Map<string, NonNullable<NightGame['result']>>();
    for (const event of sharedEvents) {
      if (event.kind !== 'finish') continue;
      const scores = Array.isArray(event.payload.scores) ? event.payload.scores : [];
      byGame.set(event.gameId, {
        winner: typeof event.payload.winner === 'string' ? event.payload.winner : null,
        ...(typeof event.payload.paying === 'string' ? { paying: event.payload.paying } : {}),
        scores: scores.flatMap((value) => {
          const row = value as { name?: unknown; score?: unknown };
          return typeof row?.name === 'string' && typeof row?.score === 'number'
            ? [{ name: row.name, score: row.score }]
            : [];
        }),
      });
    }
    return byGame;
  }, [sharedEvents]);

  const localRecord = React.useMemo(() => {
    const openedIso =
      earliestStartedAt([
        localAnchor,
        ...sessions.flatMap((selectedSession) => [
          selectedSession.startedAt,
          ...selectedSession.drinks.map((drink) => drink.at),
        ]),
        ...partyPubVisits.map((visit) => visit.startedAt),
      ]) ?? new Date(0).toISOString();
    const opened = Date.parse(openedIso);

    const sessionStops = stopsForSessions(sessions, meId);
    const explicitStops = partyPubVisits.map((visit): NightStop => ({
      id: visit.clientId,
      by: meId,
      pubName: visit.pubName,
      cacheKey: visit.pubKey,
      arrivedAt: visit.startedAt,
    }));
    const stopById = new Map(sessionStops.map((stop) => [stop.id, stop]));
    for (const stop of explicitStops) stopById.set(stop.id, stop);
    const localStops = [...stopById.values()].sort((left, right) =>
      left.arrivedAt.localeCompare(right.arrivedAt),
    );
    const stops: NightStop[] =
      live || targetEvening || confirmedIdentity || recoveredRecord
        ? localStops.length > 0
          ? localStops
          : pubName
            ? [
                {
                  id: pubKey ?? 'local-stop',
                  by: meId,
                  pubName,
                  cacheKey: pubKey ?? null,
                  arrivedAt: openedIso,
                },
              ]
            : []
        : [];

    const localNightGames: NightGame[] = localGames.map((game) => ({
      key: game.key,
      name: game.name,
      // Games this phone put on the table are owner-attributed like its drinks
      // and photos, so the privacy merge can tell them from peers' rows.
      by: meId,
      // `at` is already an epoch stamp in livePartyStore.
      startedAt: new Date(game.at).toISOString(),
      ...(game.result ? { result: game.result } : {}),
    }));
    const games = mergeNightGames(localNightGames, sharedGames, finishedResults);

    const photos: NightPhoto[] = allPhotos.flatMap((photo) => {
      const belongsToServerTable =
        !!effectiveCode && photo.partyCode?.toUpperCase() === effectiveCode.toUpperCase();
      const belongsToLocalNight =
        !!targetDrinkingDay && photo.partyDrinkingDay === targetDrinkingDay;
      if (!belongsToServerTable && !belongsToLocalNight) return [];
      const url = photo.localUri ?? photo.imageUrl;
      return url ? [{ id: photo.id ?? photo.clientId, url, at: photo.takenAt, by: meId }] : [];
    });

    const record = buildNightRecord({
      evening: targetEvening,
      session,
      sessions,
      meId,
      stops,
      games,
      photos,
      ...(opened > 0 ? { startedAt: openedIso } : {}),
      endedAt: targetEvening?.endedAt ?? recoveredRecord?.endedAt ?? null,
    });
    return confirmedIdentity && !record.code
      ? { ...record, id: confirmedIdentity.id, code: confirmedIdentity.joinCode }
      : record;
  }, [
    targetEvening,
    confirmedIdentity,
    session,
    sessions,
    meId,
    live,
    pubName,
    pubKey,
    partyPubVisits,
    localAnchor,
    localGames,
    sharedGames,
    finishedResults,
    allPhotos,
    effectiveCode,
    targetDrinkingDay,
    recoveredRecord,
  ]);

  React.useEffect(() => {
    if (!pollingEnabled) return;
    if (!code || !accountId) return;
    const controller = new AbortController();
    let inFlight = false;
    let freshRecordApplied = false;
    void loadNightRecordCache(accountId, code).then((record) => {
      if (!record || controller.signal.aborted || freshRecordApplied) return;
      setRemote({ code, accountId, record });
    });
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      const result = await fetchPartyNightRecord(code, accountId, controller.signal);
      inFlight = false;
      if (controller.signal.aborted) return;
      if (!result.ok) {
        // Terminal loss is not a cellar: the server itself says this exact
        // table is gone for this account, so keeping a cached record and an
        // active identity would fake a night that no longer exists. A plain
        // network/offline/5xx failure keeps everything as it was.
        if (
          result.code === 'party_not_found' &&
          useAccountStore.getState().session?.accountId === accountId
        ) {
          usePartyEveningStore.getState().closeLostTable(code);
        }
        return;
      }
      freshRecordApplied = true;
      void writeNightRecordCache(accountId, result.record);
      setRemote({ code, accountId, record: result.record });
    };
    const kickoff = setTimeout(() => void refresh(), 0);
    const interval = targetEvening?.active ? setInterval(() => void refresh(), REFRESH_MS) : null;
    return () => {
      clearTimeout(kickoff);
      if (interval) clearInterval(interval);
      controller.abort();
    };
  }, [code, accountId, targetEvening?.active, pollingEnabled]);

  React.useEffect(() => {
    if (!recoverLatestEnded) return;
    if (code || live) {
      onRecoveryStateChange?.('ready');
      return;
    }
    if (!accountId) {
      onRecoveryStateChange?.('unavailable');
      return;
    }
    const controller = new AbortController();
    onRecoveryStateChange?.('loading');
    void (async () => {
      let recovered = false;
      const cached = await loadLatestNightRecordCache(accountId);
      if (cached && !controller.signal.aborted) {
        recovered = true;
        setRemote({ code: cached.code, accountId, record: cached });
        onRecoveryStateChange?.('ready');
      }

      const historyResult = await fetchPartyEveningHistory(controller.signal);
      if (controller.signal.aborted) return;
      if (!historyResult.ok) {
        if (!recovered) onRecoveryStateChange?.('unavailable');
        return;
      }
      const latest = historyResult.evenings[0];
      if (!latest) {
        if (!recovered) onRecoveryStateChange?.('empty');
        return;
      }
      const recordResult = await fetchPartyNightRecord(
        latest.joinCode,
        accountId,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!recordResult.ok) {
        if (!recovered) onRecoveryStateChange?.('unavailable');
        return;
      }
      void writeNightRecordCache(accountId, recordResult.record);
      setRemote({
        code: latest.joinCode,
        accountId,
        record: recordResult.record,
      });
      onRecoveryStateChange?.('ready');
    })();
    return () => controller.abort();
  }, [recoverLatestEnded, onRecoveryStateChange, code, accountId, live]);

  const remoteCode = code ?? recoveredRecord?.code ?? null;
  const serverRecord =
    remote?.code === remoteCode && remote.accountId === accountId
      ? remote.record
      : code && accountId
        ? readNightRecordCache(accountId, code)
        : null;
  return serverRecord ? mergeNightRecords(serverRecord, localRecord) : localRecord;
}
