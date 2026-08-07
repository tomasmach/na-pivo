/**
 * DESIGN MOCK — a game, fullscreen, with the night still on screen.
 *
 * Fullscreen because a game played on a phone in a pub is passed around the
 * table, and a tab bar at the bottom of a passed-around phone is a mis-tap
 * waiting to happen.
 *
 * But the beer counter stays. The whole reason the app is out of your pocket
 * during a game is that you are also drinking, and making someone leave the
 * game to log a beer is how a night's data ends up half-recorded. So the top
 * strip carries your tally and a `+1` that never leaves the screen.
 *
 * This screen is a RUNTIME, not a game. Nine games, three shells:
 *
 *   `score`   a tally — tap a name, they get a point (Pub kvíz)
 *   `prompt`  a deck of cards, one at a time (Nikdy jsem…, Kategorie, Pravidlo)
 *   `draw`    chance, with the suspense left in (Kostky, Flaška, Runda, King's)
 *
 * The tenth game should be a row in `gameCatalog.ts` and a list of prompts, not
 * another screen. That is also what let the shared-game backend stay generic:
 * every shell writes the same two events, so nothing about playing needs a
 * per-game endpoint.
 *
 * What a game leaves behind is the part that has to be right: a scoreboard the
 * recap and the feed can lead with — but only for `points` games. A drinking
 * game keeps no tally, because the only tally it could keep is who drank most,
 * and that is the one scoreboard this product must never print.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BeerIcon, ChevronLeftIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { generateUuidV4 } from '@/data/account';
import { partyGameSeedForTable, type PartyGameEventInput } from '@/data/partyGamesClient';
import { loadPendingPartyGameRuntime } from '@/data/partyGameStartsQueue';
import { loadQueuedPartyGameEvents } from '@/data/partyGamesQueue';
import { findGame, type GameDraw } from '@/party/gameCatalog';
import { GAME_PROMPTS, KINGS_CARDS } from '@/party/gameContent';
import { QUIZ_QUESTIONS } from '@/party/quiz/questions';
import type { QuizAnswer, QuizEntrant } from '@/party/quiz/rules';
import {
  foldDiceActions,
  foldSharedGameActions,
  latestDraw,
  latestPick,
  promptStep,
  type SharedGameActionPayload,
} from '@/party/sharedGameActions';
import { DiceDuelShell } from '@/party/shells/DiceDuelShell';
import { DrawShell } from '@/party/shells/DrawShell';
import { GameLobby, type LobbyPlayer } from '@/party/shells/GameLobby';
import { PickShell } from '@/party/shells/PickShell';
import { PromptShell } from '@/party/shells/PromptShell';
import { QuizShell } from '@/party/shells/QuizShell';
import { tintFor } from '@/party/nightBuilder';
import { beersOf, nightMe, nightStandings } from '@/party/nightRecord';
import { useNightRecord } from '@/party/useNightRecord';
import {
  eventsOfGame,
  useFollowPartyGames,
  usePartyGamesStore,
} from '@/stores/partyGamesStore';
import {
  selectConfirmedPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';
import { usePartyBeer } from '@/party/usePartyBeer';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/**
 * When an answer landed — only ever used to order answers within one team.
 *
 * Module scope because `react-hooks/purity` flags `Date.now()` anywhere in a
 * component body and cannot tell a handler from render.
 */
function stamp(): number {
  return Date.now();
}

/** The verb IS the game — "roztoč" and "hoď" are different promises. */
const DRAW_ACTION: Record<GameDraw, string> = {
  person: 'Roztoč',
  card: 'Táhni kartu',
};
const KINGS_CARD_IDS = new Set(KINGS_CARDS.map((card) => card.card));

export default function PartyGameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();

  const houseBeer = useLivePartyStore((s) => s.houseBeer);
  const finishGame = useLivePartyStore((s) => s.finishGame);
  const games = useLivePartyStore((s) => s.games);

  const def = key ? findGame(key) : undefined;
  const name = def?.name ?? games.find((entry) => entry.key === key)?.name ?? 'Hra';
  // Points games crown someone; sip games do not. See `gameCatalog`.
  const onPoints = def?.scoring !== 'drinks';
  const shell = def?.shell ?? 'score';
  const prompts = key ? (GAME_PROMPTS[key] ?? []) : [];
  // Varies the deal per game without calling `Math.random()` in render, which
  // is impure and the lint rule is right to stop.
  const [localSeed] = React.useState(() => Date.now() & 0xffff);

  // Who is at the night, you first. The lobby turns this into who is PLAYING —
  // the two are not the same, and starting a game with everyone in the evening
  // is how the first round becomes an argument about whose turn it is.
  const night = useNightRecord();
  const currentPlayerId = nightMe(night)?.id;
  const beer = usePartyBeer();

  /**
   * The shared side of a game.
   *
   * A game put on the table becomes a `PartyGame` row so the other phones can
   * see it, and everything that happens in it becomes an event. Without an
   * evening there is nothing to share with and this stays null — the game plays
   * exactly as it did before, on one phone.
   */
  useFollowPartyGames(usePartyEveningStore(selectConfirmedPartyJoinCode));
  const sharedGames = usePartyGamesStore((s) => s.games);
  const gameEvents = usePartyGamesStore((s) => s.events);
  const startSharedGame = usePartyGamesStore((s) => s.start);
  const sendGameEvent = usePartyGamesStore((s) => s.send);
  const sharedCode = usePartyGamesStore((s) => s.code);
  const sharingFailure = usePartyGamesStore((s) =>
    key ? s.sharingFailures[key] : undefined,
  );
  const sharedGame = key && sharedCode
    ? (sharedGames.find((game) => game.catalogKey === key) ?? null)
    : null;
  const table = React.useMemo(
    () =>
      nightStandings(night)
        .filter((person) => person.active !== false)
        .map((person) => ({ id: person.id, name: person.name, tint: person.tint })),
    [night],
  );
  // YOUR tally, not the table's — the strip is your counter.
  const myBeers = beersOf(night, nightMe(night)?.id);
  const [selectedRoster, setSelectedRoster] = React.useState<LobbyPlayer[] | null>(null);
  const gameScope = `${sharedCode ?? 'local'}:${key ?? ''}`;
  const [localGame, setLocalGame] = React.useState<{ scope: string; id: string } | null>(null);
  const serverRoster = React.useMemo<LobbyPlayer[] | null>(() => {
    if (!sharedGame || sharedGame.roster.length === 0) return null;
    return sharedGame.roster.map((person) => ({
      id: person.id,
      name: person.nickname ?? person.displayName,
      tint: table.find((candidate) => candidate.id === person.id)?.tint ?? tintFor(person.id),
    }));
  }, [sharedGame, table]);
  const roster = serverRoster ?? selectedRoster;
  const localGameId = localGame?.scope === gameScope ? localGame.id : null;
  // The server id wins as soon as the queued start lands. Until then every
  // answer and finish uses the durable local correlation stored with the start.
  const gameId = sharedGame?.id ?? localGameId;
  const seed = sharedGame?.seed ?? (
    sharedCode && key ? partyGameSeedForTable(sharedCode, key) : localSeed
  );

  const beginGame = React.useCallback(
    async (selected: LobbyPlayer[]) => {
      if (!key || !sharedCode) {
        setSelectedRoster(selected);
        return;
      }
      // Stay in the lobby for the few milliseconds needed to durably persist
      // the correlation. Once the game renders, every tap has somewhere safe
      // to queue even if the POST is still in flight.
      const handle = await startSharedGame({
        catalogKey: key,
        name,
        scoring: def?.scoring === 'drinks' ? 'drinks' : 'points',
        rosterIds: selected.map((person) => person.id),
      });
      if (!handle) {
        // Storage failure disables sharing, not the local pub game.
        setSelectedRoster(selected);
        return;
      }
      setLocalGame({ scope: gameScope, id: handle.gameId });
      const candidates = new Map([...table, ...selected].map((person) => [person.id, person]));
      const persisted = handle.rosterIds.flatMap((id) => {
        const person = candidates.get(id);
        return person ? [person] : [];
      });
      setSelectedRoster(
        handle.rosterIds.length > 0 && persisted.length === handle.rosterIds.length
          ? persisted
          : selected,
      );
    },
    [def?.scoring, gameScope, key, name, sharedCode, startSharedGame, table],
  );

  const localScoreSequence = React.useRef(0);
  const [localScoreEvents, setLocalScoreEvents] = React.useState<{
    id: string | number;
    subjectId: string;
    delta: number;
    createdAt: string;
  }[]>([]);
  const [localActionEvents, setLocalActionEvents] = React.useState<PartyGameEventInput[]>([]);

  /**
   * Pub kvíz — the one game that is genuinely played on several phones.
   *
   * Entrants are the people AT THE EVENING, keyed by account id rather than by
   * name: a name is what you show, an id is what two phones can agree on. At a
   * table everybody answers for themselves, so a person is a TEAM OF ONE — the
   * same game at a community event has real teams and no rule changes
   * (`src/party/quiz/rules.ts`).
   *
   * Self-paced on purpose. Every phone keeps its own question index and the
   * reveal happens per QUESTION, once every team has committed to that one —
   * so nobody waits for a host to press next, and the slowest reader does not
   * hold up the table.
   */
  const entrants = React.useMemo<QuizEntrant[]>(
    () =>
      (roster ?? []).map((person) => ({
        id: person.id,
        teamId: person.id,
        teamName: person.name,
      })),
    [roster],
  );

  // Mine, folded in the moment I tap, and everybody's as the stream delivers
  // them. No dedupe key is needed: a team's answer is its FIRST one, so my own
  // answer coming back from the server folds to the same result as the local
  // copy it duplicates.
  const [myAnswers, setMyAnswers] = React.useState<QuizAnswer[]>([]);
  React.useEffect(() => {
    if (!sharedCode || !key) return;
    let cancelled = false;
    void (async () => {
      const pendingRuntime = await loadPendingPartyGameRuntime(sharedCode, key);
      if (cancelled) return;

      const ids = new Set<string>();
      if (sharedGame?.id) ids.add(sharedGame.id);
      if (pendingRuntime) {
        ids.add(pendingRuntime.localGameId);
        setLocalGame((current) =>
          current?.scope === gameScope && current.id === pendingRuntime.localGameId
            ? current
            : { scope: gameScope, id: pendingRuntime.localGameId },
        );
        const candidates = new Map(table.map((person) => [person.id, person]));
        const restoredRoster = pendingRuntime.rosterIds.flatMap((id) => {
          const person = candidates.get(id);
          return person ? [person] : [];
        });
        if (
          restoredRoster.length > 0 &&
          restoredRoster.length === pendingRuntime.rosterIds.length
        ) {
          setSelectedRoster((current) =>
            current?.map((person) => person.id).join('\u0000') ===
            restoredRoster.map((person) => person.id).join('\u0000')
              ? current
              : restoredRoster,
          );
        }
      }
      if (gameId) ids.add(gameId);
      const queued = await loadQueuedPartyGameEvents(sharedCode, [...ids]);
      if (cancelled || queued.length === 0) return;
      const me = currentPlayerId;
      if (me) {
        const restoredAnswers = queued.flatMap(({ event, queuedAt }) => {
          if (event.kind !== 'answer') return [];
          const questionId = event.payload?.questionId;
          const option = event.payload?.option;
          if (typeof questionId !== 'string' || typeof option !== 'number') return [];
          const parsedAt = event.createdAt ? Date.parse(event.createdAt) : queuedAt;
          return [{
            entrantId: me,
            questionId,
            option,
            at: Number.isFinite(parsedAt) ? parsedAt : queuedAt,
          }];
        });
        if (restoredAnswers.length > 0) setMyAnswers((current) => {
          const seen = new Set(
            current.map((answer) => `${answer.entrantId}\u0000${answer.questionId}`),
          );
          const additions = restoredAnswers.filter((answer) => {
              const identity = `${answer.entrantId}\u0000${answer.questionId}`;
              if (seen.has(identity)) return false;
              seen.add(identity);
              return true;
            });
          return additions.length > 0 ? [...current, ...additions] : current;
        });
      }
      const restoredScores = queued.flatMap(({ event, queuedAt }) => {
        if (
          event.kind !== 'score' ||
          typeof event.subjectId !== 'string' ||
          typeof event.delta !== 'number'
        ) return [];
        return [{
          id: event.clientId,
          subjectId: event.subjectId,
          delta: event.delta,
          createdAt: event.createdAt ?? new Date(queuedAt).toISOString(),
        }];
      });
      if (restoredScores.length > 0) setLocalScoreEvents((current) => {
        const seen = new Set(current.map((event) => event.id));
        const additions = restoredScores.filter((event) => {
            if (seen.has(event.id)) return false;
            seen.add(event.id);
            return true;
          });
        return additions.length > 0 ? [...current, ...additions] : current;
      });
      const restoredActions = queued
        .map(({ event }) => event)
        .filter((event): event is PartyGameEventInput => event.kind === 'action');
      if (restoredActions.length > 0) setLocalActionEvents((current) => {
        const seen = new Set(current.map((event) => event.clientId));
        const additions = restoredActions.filter((event) => {
          if (seen.has(event.clientId)) return false;
          seen.add(event.clientId);
          return true;
        });
        return additions.length > 0 ? [...current, ...additions] : current;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPlayerId, gameId, gameScope, key, sharedCode, sharedGame?.id, table]);
  const sharedActions = React.useMemo(
    () => foldSharedGameActions(eventsOfGame(gameEvents, gameId), localActionEvents),
    [gameEvents, gameId, localActionEvents],
  );
  const rosterIds = React.useMemo(
    () => new Set((roster ?? []).map((person) => person.id)),
    [roster],
  );
  const appendAction = React.useCallback(
    (payload: SharedGameActionPayload) => {
      if (!gameId) return;
      const clientId = generateUuidV4();
      const event: PartyGameEventInput = {
        clientId,
        kind: 'action',
        payload,
        createdAt: new Date(stamp()).toISOString(),
      };
      setLocalActionEvents((current) => [...current, event]);
      void sendGameEvent(
        gameId,
        { kind: 'action', payload, createdAt: event.createdAt },
        clientId,
      );
    },
    [gameId, sendGameEvent],
  );
  const sharedPromptStep = promptStep(sharedActions);
  const sharedDrawKind = def?.draw ?? 'person';
  const sharedDraw = latestDraw(
    sharedActions,
    sharedDrawKind,
    sharedDrawKind === 'person'
      ? rosterIds
      : KINGS_CARD_IDS,
  );
  const sharedPick = latestPick(sharedActions, rosterIds);
  const sharedDiceState = React.useMemo(
    () => (roster && gameId ? foldDiceActions(roster, sharedActions) : undefined),
    [gameId, roster, sharedActions],
  );
  const remoteAnswers = React.useMemo<QuizAnswer[]>(
    () =>
      eventsOfGame(gameEvents, gameId)
        .filter((event) => event.kind === 'answer')
        .flatMap((event) => {
          const questionId = event.payload.questionId;
          const option = event.payload.option;
          if (typeof questionId !== 'string' || typeof option !== 'number') return [];
          return [
            {
              entrantId: event.account.id,
              questionId,
              option,
              at: new Date(event.at).getTime(),
            },
          ];
        }),
    [gameEvents, gameId],
  );
  const answers = React.useMemo(
    () => [...myAnswers, ...remoteAnswers],
    [myAnswers, remoteAnswers],
  );
  const [question, setQuestion] = React.useState(0);
  const [revealed, setRevealed] = React.useState<number[]>([]);

  const answer = (option: number) => {
    const current = QUIZ_QUESTIONS[question];
    const me = nightMe(night)?.id;
    if (!current || !me || !entrants.some((entrant) => entrant.id === me)) return;
    const at = stamp();
    setMyAnswers((list) =>
      // A team's answer is its first one, so a second tap is not an edit.
      list.some((entry) => entry.entrantId === me && entry.questionId === current.id)
        ? list
        : [...list, { entrantId: me, questionId: current.id, option, at }],
    );
    // …and to the table. Queued, so a pub with no signal costs nothing.
    if (gameId) {
      void sendGameEvent(gameId, {
        kind: 'answer',
        payload: { questionId: current.id, option },
        createdAt: new Date(at).toISOString(),
      });
    }
  };

  const scoreSignature = (subjectId: string, delta: number, at: string) =>
    `${subjectId}\u0000${delta}\u0000${Date.parse(at)}`;
  const serverScoreEvents = gameEvents.filter(
    (event) => event.gameId === gameId && event.kind === 'score' && event.subject,
  );
  const pendingLocalScores = React.useMemo(() => {
    const me = nightMe(night)?.id;
    const acknowledgements = new Map<string, number>();
    for (const event of serverScoreEvents) {
      if (!event.subject || event.account.id !== me) continue;
      const signature = scoreSignature(event.subject.id, event.delta, event.at);
      acknowledgements.set(signature, (acknowledgements.get(signature) ?? 0) + 1);
    }
    return localScoreEvents.filter((event) => {
      const signature = scoreSignature(event.subjectId, event.delta, event.createdAt);
      const remaining = acknowledgements.get(signature) ?? 0;
      if (remaining === 0) return true;
      acknowledgements.set(signature, remaining - 1);
      return false;
    });
  }, [localScoreEvents, night, serverScoreEvents]);
  const scoresById = React.useMemo(() => {
    const scores: Record<string, number> = {};
    for (const event of serverScoreEvents) {
      if (!event.subject) continue;
      scores[event.subject.id] = (scores[event.subject.id] ?? 0) + event.delta;
    }
    for (const event of pendingLocalScores) {
      scores[event.subjectId] = (scores[event.subjectId] ?? 0) + event.delta;
    }
    return scores;
  }, [pendingLocalScores, serverScoreEvents]);
  const bump = (player: LobbyPlayer) => {
    const createdAt = new Date(stamp()).toISOString();
    localScoreSequence.current += 1;
    setLocalScoreEvents((current) => [
      ...current,
      {
        id: localScoreSequence.current,
        subjectId: player.id,
        delta: 1,
        createdAt,
      },
    ]);
    if (gameId) {
      void sendGameEvent(gameId, {
        kind: 'score',
        subjectId: player.id,
        delta: 1,
        createdAt,
      });
    }
  };

  const ranked = (roster ?? [])
    .map((player) => ({ ...player, score: scoresById[player.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const leader = ranked[0];
  const played = ranked.some((row) => row.score > 0);

  /**
   * How a game ends — in one place, said twice.
   *
   * Locally, so this phone's recap has it the instant you look; and as the
   * `finish` event, so every other phone at the table ends the game with the
   * same winner instead of its own guess. The server stamps `ended_at` from
   * that same event, which is what closes the row.
   *
   * The result travels IN the event rather than being recomputed elsewhere: a
   * game's outcome is the game's to state, and two devices re-deriving it from
   * partial events is how a table ends up arguing about who paid.
   */
  const report = (result: {
    winner: string | null;
    scores: { name: string; score: number }[];
    paying?: string | null;
  }) => {
    if (gameId) {
      void sendGameEvent(gameId, {
        kind: 'finish',
        payload: {
          winner: result.winner,
          scores: result.scores,
          ...(result.paying !== undefined ? { paying: result.paying } : {}),
        },
      });
    }
    if (key) finishGame(key, { game: name, ...result });
  };

  const finish = () => {
    report({
      // A drinking game names nobody, and keeps no tally: the only tally it
      // could keep is who drank most.
      winner: onPoints && played ? leader.name : null,
      scores: onPoints ? ranked : [],
    });
    router.back();
  };

  return (
    <View style={styles.screen}>
      {/* The night, pinned. Back on the left, tally and +1 on the right — the
          two things you reach for without looking away from the table. */}
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpátky do večera"
          hitSlop={6}
        >
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </Pressable>

        <Text style={styles.topTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {name}
        </Text>

        {/* Ending is up here, as far from everything you tap during a game as
            the screen allows — and it is text, not a full-width amber bar
            competing with the button you actually press. */}
        {roster ? (
          <Pressable
            onPress={finish}
            style={({ pressed }) => [styles.end, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Ukončit hru"
            hitSlop={8}
          >
            <Text style={styles.endText} allowFontScaling={false}>
              Konec
            </Text>
          </Pressable>
        ) : null}
      </View>

      {sharingFailure && roster ? (
        <Text style={styles.sharingFailure} maxFontSizeMultiplier={FontScaleCap.body}>
          Hra běží jen na tomhle telefonu. {sharingFailure}
        </Text>
      ) : null}

      {roster === null ? (
        <GameLobby
          def={def}
          table={table}
          onStart={(selected) => {
            void beginGame(selected);
          }}
        />
      ) : null}

      {roster && shell === 'turns' ? (
        <DiceDuelShell
          players={roster}
          state={sharedDiceState}
          onRoll={gameId ? ({ playerId, dice }) => {
            appendAction({ type: 'dice_roll', playerId, dice });
          } : undefined}
          onNextRound={gameId ? () => appendAction({ type: 'dice_next' }) : undefined}
          // Dice already reported their canonical result before GameResult is
          // shown. This button only leaves; reporting again would overwrite the
          // payer and standings with the generic empty score.
          onDone={() => router.back()}
          onFinished={(result) => {
            // The board is round wins. "Who paid" is the story, and it is the
            // line the recap and the feed lead with.
            report({
              winner: result.standings[0]?.name ?? null,
              scores: result.standings,
              paying: result.paying,
            });
          }}
        />
      ) : null}

      {roster && shell === 'pick' ? (
        <PickShell
          game={key === 'bottle' ? 'bottle' : 'wheel'}
          players={roster}
          action="Roztoč"
          verdict={(name) =>
            key === 'bottle'
              ? `${name} je na řadě`
              : name === 'Ty'
                ? 'Platíš ty'
                : `Platí ${name}`
          }
          // Only the round game ends on the first spin; the bottle keeps going
          // until the table has had enough.
          // The wheel reports its payer when it stops. Leaving GameResult must
          // not append a second, empty finish event over that result.
          onDone={key === 'round' ? () => router.back() : undefined}
          pickedId={gameId ? (sharedPick?.playerId ?? null) : undefined}
          onPicked={gameId ? (playerId) => appendAction({ type: 'pick', playerId }) : undefined}
          onFinished={
            key === 'round'
              ? (paying) => report({ winner: null, scores: [], paying })
              : undefined
          }
        />
      ) : null}

      {roster && shell === 'quiz' ? (
        <QuizShell
          entrants={entrants}
          answers={answers}
          me={nightMe(night)?.id ?? 'me'}
          index={question}
          tintOf={(name) => roster.find((person) => person.name === name)?.tint ?? Colors.amber}
          forceRevealed={revealed.includes(question)}
          onAnswer={(option) => answer(option)}
          onReveal={() => setRevealed((current) => [...current, question])}
          onNext={() => setQuestion((current) => current + 1)}
          onFinished={(result) => {
            if (!key) return;
            report({ winner: result.winner, scores: result.standings });
          }}
          onDone={() => router.back()}
        />
      ) : null}

      {roster && shell === 'prompt' ? (
        <PromptShell
          prompts={prompts}
          intro={def?.intro}
          seed={seed}
          step={gameId ? sharedPromptStep : undefined}
          onNext={gameId ? () => appendAction({ type: 'prompt_next' }) : undefined}
        />
      ) : null}

      {roster && shell === 'draw' ? (
        <DrawShell
          kind={def?.draw ?? 'person'}
          players={roster}
          intro={def?.intro}
          action={DRAW_ACTION[def?.draw ?? 'person']}
          result={gameId && sharedDraw ? {
            nonce: sharedDraw.clientId,
            ...(sharedDraw.drawKind === 'person'
              ? { personId: sharedDraw.value }
              : { cardId: sharedDraw.value }),
          } : gameId ? null : undefined}
          onDraw={gameId ? (result) => {
            const drawKind = def?.draw ?? 'person';
            const value = drawKind === 'person' ? result.personId : result.cardId;
            if (value) appendAction({ type: 'draw', drawKind, value });
          } : undefined}
        />
      ) : null}

      {roster && shell === 'score' ? (
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The rules, on the screen. Nobody remembers how King's Cup goes and
            looking it up mid-round is how a game dies. */}
        {def ? (
          <Text style={styles.rules} maxFontSizeMultiplier={FontScaleCap.body}>
            {def.how}
          </Text>
        ) : null}
        <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
          {onPoints ? 'Ťukni na toho, kdo bodoval.' : 'Ťukni na toho, kdo pije.'}
        </Text>

        {ranked.map((row, index) => (
          <Pressable
            key={row.name}
            onPress={() => bump(row)}
            style={({ pressed }) => [
              styles.player,
              onPoints && index === 0 && played && styles.playerLeader,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Bod pro ${row.name}. Aktuálně ${row.score}`}
          >
            <Text
              style={styles.playerName}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {row.name}
            </Text>
            <Text style={styles.playerScore} allowFontScaling={false}>
              {row.score}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      ) : null}

      {/* The counter floats bottom-right rather than sitting in the header: the
          one thing you do mid-game besides play is log a beer, and that belongs
          under your thumb, not up by the exit. */}
      {roster ? (
        <Pressable
          onPress={() => beer.add(houseBeer)}
          style={({ pressed }) => [
            styles.counter,
            { bottom: insets.bottom + Spacing.md },
            pressed && styles.counterPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Máš ${myBeers} piv. Přidat další.`}
        >
          <BeerIcon size={17} color={Colors.stout} />
          <Text style={styles.counterText} allowFontScaling={false}>
            {myBeers}
          </Text>
          <PlusIcon size={14} color={Colors.stout} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  pressed: { opacity: 0.7 },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.1),
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: Colors.foam },
  end: { paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  endText: { fontSize: 16, fontWeight: '700', color: Colors.amber },
  sharingFailure: {
    paddingHorizontal: MockLayout.screenPad,
    paddingVertical: Spacing.sm,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.amber,
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  counter: {
    position: 'absolute',
    right: MockLayout.screenPad,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  counterPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  counterText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.stout,
    fontVariant: ['tabular-nums'],
  },

  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.lg, gap: Spacing.sm },
  rules: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.foam,
    lineHeight: 21,
  },
  hint: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.mutedText,
    marginBottom: Spacing.sm,
  },

  player: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HitArea.min + 22,
    paddingHorizontal: Spacing.lg,
    borderRadius: 22,
    backgroundColor: MockColors.surfaceHigh,
  },
  playerLeader: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  playerName: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.foam },
  playerScore: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  foot: {
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  finish: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  finishText: { ...MockType.buttonLabel, color: Colors.stout },
});
