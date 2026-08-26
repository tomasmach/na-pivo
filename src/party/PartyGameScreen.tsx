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

import React from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  BeerIcon,
  ChevronLeftIcon,
  PlusIcon,
} from "@/components/shared/IconGlyph";
import { generateUuidV4 } from "@/data/account";
import {
  partyGameSeedForTable,
  type PartyGameEventInput,
} from "@/data/partyGamesClient";
import { loadPendingPartyGameRuntime } from "@/data/partyGameStartsQueue";
import { loadQueuedPartyGameEvents } from "@/data/partyGamesQueue";
import { findGame, type GameDraw } from "@/party/gameCatalog";
import {
  GameResult,
  type ResultPlayerReference,
} from "@/games/GameResult";
import { cs } from "@/i18n/cs";
import { beerCountLabel } from "@/i18n/plural";
import { GAME_PROMPTS, KINGS_CARDS, KINGS_DECK } from "@/party/gameContent";
import { QUIZ_QUESTIONS } from "@/party/quiz/questions";
import {
  quizFinishResult,
  quizState,
  type QuizAnswer,
  type QuizEntrant,
} from "@/party/quiz/rules";
import {
  foldDiceActions,
  foldSharedGameActions,
  cardDrawActions,
  cardDraws,
  canonicalGameFinish,
  latestDraw,
  latestPick,
  promptStep,
  quizProgress,
  pickRevision,
  type CanonicalGameFinish,
  type SharedGameActionPayload,
} from "@/party/sharedGameActions";
import { DiceDuelShell } from "@/party/shells/DiceDuelShell";
import { DrawShell } from "@/party/shells/DrawShell";
import { GameLobby, type LobbyPlayer } from "@/party/shells/GameLobby";
import { InviteSheet } from "@/party/InviteSheet";
import { PickShell } from "@/party/shells/PickShell";
import { PromptShell } from "@/party/shells/PromptShell";
import { QuizShell } from "@/party/shells/QuizShell";
import { RoundDrumShell } from "@/party/shells/RoundDrumShell";
import { minimizeParty } from "@/party/partyRouting";
import { fallbackPlayerName, tintFor } from "@/party/nightBuilder";
import { beersOf, nightMe, nightStandings } from "@/party/nightRecord";
import { useNightRecord } from "@/party/useNightRecord";
import { usePartyBeer } from "@/party/usePartyBeer";
import {
  eventsOfGame,
  useFollowPartyGames,
  usePartyGamesStore,
} from "@/stores/partyGamesStore";
import {
  selectConfirmedPartyJoinCode,
  usePartyEveningStore,
} from "@/stores/partyEveningStore";
import { useLivePartyStore } from "@/mocks/livePartyStore";
import { MockColors, MockLayout, MockType } from "@/mocks/mockTheme";
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { HitArea, Radius, Spacing } from "@/theme/layout";

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
  person: "Roztoč",
  card: "Táhni kartu",
};
const KINGS_CARD_IDS = new Set([
  ...KINGS_CARDS.map((card) => card.card),
  ...KINGS_DECK.map((card) => card.id),
]);

function playerName(value: string | null | undefined, id: string): string {
  return value?.trim() || fallbackPlayerName(id);
}

function canonicalResultReference(
  roster: LobbyPlayer[],
  id: string | null | undefined,
  legacyName: string | null | undefined,
): ResultPlayerReference | null {
  return id && roster.some((player) => player.id === id)
    ? { kind: "id", value: id }
    : legacyName
      ? { kind: "name", value: legacyName }
      : null;
}

/** One score row, said the same way in the label and in the announcement. */
function scoreAccessibilityLabel(name: string, score: number): string {
  return `Bod pro ${name}. Aktuálně ${score}`;
}

/** First player by sorted id — the same phone-independent pick on every device. */
function deterministicFirstPlayer(roster: LobbyPlayer[]): LobbyPlayer | null {
  return (
    [...roster].sort((left, right) => left.id.localeCompare(right.id))[0] ??
    null
  );
}

function sameRoster(left: LobbyPlayer[] | null, right: LobbyPlayer[]): boolean {
  return Boolean(
    left &&
    left.length === right.length &&
    left.every(
      (player, index) =>
        player.id === right[index]?.id &&
        player.name === right[index]?.name &&
        player.tint === right[index]?.tint,
    ),
  );
}

export default function PartyGameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const leaveGame = () => minimizeParty(router);
  const { key } = useLocalSearchParams<{ key: string }>();

  const finishGame = useLivePartyStore((s) => s.finishGame);
  const games = useLivePartyStore((s) => s.games);
  const houseBeer = useLivePartyStore((s) => s.houseBeer);

  const def = key ? findGame(key) : undefined;
  const name =
    def?.name ?? games.find((entry) => entry.key === key)?.name ?? "Hra";
  // Points games crown someone; sip games do not. See `gameCatalog`.
  const onPoints = def?.scoring !== "drinks";
  const shell = def?.shell ?? "score";
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
  const beerCount = beersOf(night, currentPlayerId);

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
  const eveningLink = usePartyEveningStore((s) => s.evening?.joinUrl ?? null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const sharingFailure = usePartyGamesStore((s) =>
    key ? s.sharingFailures[key] : undefined,
  );
  const sharedGame =
    key && sharedCode
      ? (sharedGames.find((game) => game.catalogKey === key) ?? null)
      : null;
  const knownLegacyGame = Boolean(
    key &&
      !def &&
      (sharedGame || games.some((game) => game.key === key)),
  );
  const invalidGame = !key || (!def && !knownLegacyGame);
  React.useEffect(() => {
    if (invalidGame) minimizeParty(router);
  }, [invalidGame, router]);
  const table = React.useMemo(
    () =>
      nightStandings(night)
        .filter((person) => person.active !== false)
        .map((person) => ({
          id: person.id,
          name: playerName(person.name, person.id),
          tint: person.tint,
        })),
    [night],
  );
  const [selectedRoster, setSelectedRoster] = React.useState<
    LobbyPlayer[] | null
  >(null);
  const gameScope = `${sharedCode ?? "local"}:${key ?? ""}`;
  const activeGameScopeRef = React.useRef<string | null>(gameScope);
  React.useLayoutEffect(() => {
    activeGameScopeRef.current = gameScope;
  }, [gameScope]);
  React.useEffect(
    () => () => {
      activeGameScopeRef.current = null;
    },
    [],
  );
  const [quizStartRetry, setQuizStartRetry] = React.useState<{
    scope: string;
    roster: LobbyPlayer[];
  } | null>(null);
  const retryQuizRoster =
    quizStartRetry?.scope === gameScope ? quizStartRetry.roster : null;
  const [localGame, setLocalGame] = React.useState<{
    scope: string;
    id: string;
  } | null>(null);
  const serverRoster = React.useMemo<LobbyPlayer[] | null>(() => {
    if (!sharedGame || sharedGame.roster.length === 0) return null;
    return sharedGame.roster.map((person) => ({
      id: person.id,
      name: playerName(person.nickname || person.displayName, person.id),
      tint:
        table.find((candidate) => candidate.id === person.id)?.tint ??
        tintFor(person.id),
    }));
  }, [sharedGame, table]);
  const gameCurrentPlayerId = currentPlayerId;
  const legacyGameAlreadyPlayed = Boolean(
    sharedGame &&
    sharedGame.roster.length === 0 &&
    gameEvents.some(
      (event) => event.gameId === sharedGame.id && event.kind !== "start",
    ),
  );
  // A frozen roster that does not hold this phone means the table is playing
  // without me. Unknown current player (cold start), local pass-the-phone and
  // the legacy empty-roster cover all stay interactive.
  const spectator = Boolean(
    sharedGame &&
    sharedGame.roster.length > 0 &&
    gameCurrentPlayerId &&
    !sharedGame.roster.some((person) => person.id === gameCurrentPlayerId),
  );
  // On the current backend an empty roster is only a cover placed on the
  // table. The first confirmed lobby must bind its selection before play.
  // A released backend could already have accepted gameplay without a frozen
  // roster; a real non-start event is the compatibility proof for that case.
  const roster = sharedGame
    ? ((serverRoster && sameRoster(selectedRoster, serverRoster)
        ? selectedRoster
        : serverRoster) ??
      selectedRoster ??
      (legacyGameAlreadyPlayed ? table : null))
    : selectedRoster;
  const localGameId = localGame?.scope === gameScope ? localGame.id : null;
  // The server id wins as soon as the queued start lands. Until then every
  // answer and finish uses the durable local correlation stored with the start.
  const gameId = sharedGame?.id ?? localGameId;
  const seed =
    sharedGame?.seed ??
    (sharedCode && key ? partyGameSeedForTable(sharedCode, key) : localSeed);

  const beginGame = React.useCallback(
    async (selected: LobbyPlayer[]) => {
      if (!key) {
        setSelectedRoster(selected);
        return;
      }
      // Pub quiz is the only game where every player needs their own phone.
      // Without a shared durable game, a local fallback would wait forever for
      // answers the other players have no way to submit.
      if (!sharedCode) {
        if (key === "quiz") {
          setQuizStartRetry({ scope: gameScope, roster: selected });
          return;
        }
        setSelectedRoster(selected);
        return;
      }
      // Stay in the lobby for the few milliseconds needed to durably persist
      // the correlation. Once the game renders, every tap has somewhere safe
      // to queue even if the POST is still in flight.
      const handle = await startSharedGame({
        catalogKey: key,
        name,
        scoring: def?.scoring === "drinks" ? "drinks" : "points",
        rosterIds: selected.map((person) => person.id),
      });
      if (!handle) {
        if (key === "quiz") {
          setQuizStartRetry({ scope: gameScope, roster: selected });
          return;
        }
        // Storage failure disables sharing, not a pass-the-phone pub game.
        setSelectedRoster(selected);
        return;
      }
      setQuizStartRetry(null);
      setLocalGame({ scope: gameScope, id: handle.gameId });
      const candidates = new Map(
        [...table, ...selected].map((person) => [person.id, person]),
      );
      const persisted = handle.rosterIds.flatMap((id) => {
        const person = candidates.get(id);
        return person ? [person] : [];
      });
      setSelectedRoster(
        handle.rosterIds.length > 0 &&
          persisted.length === handle.rosterIds.length
          ? persisted
          : selected,
      );
    },
    [def?.scoring, gameScope, key, name, sharedCode, startSharedGame, table],
  );

  const [localScoreEvents, setLocalScoreEvents] = React.useState<
    {
      id: string | number;
      subjectId: string;
      delta: number;
      createdAt: string;
    }[]
  >([]);
  const [localActionEvents, setLocalActionEvents] = React.useState<
    PartyGameEventInput[]
  >([]);
  React.useEffect(() => {
    if (
      !sharedGame ||
      !serverRoster ||
      sameRoster(selectedRoster, serverRoster)
    )
      return undefined;
    const timer = setTimeout(() => {
      // The first server-confirmed lobby wins. A different local lobby contains
      // different people, not an index-by-index identity map. Keep queued event
      // ids untouched so roster validation can ignore an excluded player instead
      // of attributing their action to whoever occupies the same position.
      setSelectedRoster((current) =>
        sameRoster(current, serverRoster) ? current : serverRoster,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedRoster, serverRoster, sharedGame]);

  /**
   * Pub kvíz — the one game that is genuinely played on several phones.
   *
   * Entrants are the people AT THE EVENING, keyed by account id rather than by
   * name: a name is what you show, an id is what two phones can agree on. At a
   * table everybody answers for themselves, so a person is a TEAM OF ONE — the
   * same game at a community event has real teams and no rule changes
   * (`src/party/quiz/rules.ts`).
   *
   * The action log owns the shared question and forced reveal. Every phone
   * advances from the same cursor, while answers stay independent append-only
   * events keyed by player and question.
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
          current?.scope === gameScope &&
          current.id === pendingRuntime.localGameId
            ? current
            : { scope: gameScope, id: pendingRuntime.localGameId },
        );
        const candidates = new Map(table.map((person) => [person.id, person]));
        const restoredRoster = pendingRuntime.rosterIds.flatMap((id) => {
          const person = candidates.get(id);
          return person ? [person] : [];
        });
        if (
          !serverRoster &&
          restoredRoster.length > 0 &&
          restoredRoster.length === pendingRuntime.rosterIds.length
        ) {
          setSelectedRoster((current) =>
            current?.map((person) => person.id).join("\u0000") ===
            restoredRoster.map((person) => person.id).join("\u0000")
              ? current
              : restoredRoster,
          );
        }
      }
      if (gameId) ids.add(gameId);
      const queued = await loadQueuedPartyGameEvents(sharedCode, [...ids]);
      if (cancelled || queued.length === 0) return;
      const me = gameCurrentPlayerId;
      if (me) {
        const restoredAnswers = queued.flatMap(({ event, queuedAt }) => {
          if (event.kind !== "answer") return [];
          const questionId = event.payload?.questionId;
          const option = event.payload?.option;
          if (typeof questionId !== "string" || typeof option !== "number")
            return [];
          const parsedAt = event.createdAt
            ? Date.parse(event.createdAt)
            : queuedAt;
          return [
            {
              entrantId: me,
              questionId,
              option,
              at: Number.isFinite(parsedAt) ? parsedAt : queuedAt,
            },
          ];
        });
        if (restoredAnswers.length > 0)
          setMyAnswers((current) => {
            const seen = new Set(
              current.map(
                (answer) => `${answer.entrantId}\u0000${answer.questionId}`,
              ),
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
          event.kind !== "score" ||
          typeof event.subjectId !== "string" ||
          typeof event.delta !== "number"
        )
          return [];
        return [
          {
            id: event.clientId,
            subjectId: event.subjectId,
            delta: event.delta,
            createdAt: event.createdAt ?? new Date(queuedAt).toISOString(),
          },
        ];
      });
      if (restoredScores.length > 0)
        setLocalScoreEvents((current) => {
          const seen = new Set(current.map((event) => event.id));
          const additions = restoredScores.filter((event) => {
            if (seen.has(event.id)) return false;
            seen.add(event.id);
            return true;
          });
          return additions.length > 0 ? [...current, ...additions] : current;
        });
      const restoredActions = queued.flatMap(({ event }) =>
        event.kind === "action" ? [event] : [],
      );
      if (restoredActions.length > 0)
        setLocalActionEvents((current) => {
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
  }, [
    gameCurrentPlayerId,
    gameId,
    gameScope,
    key,
    sharedCode,
    sharedGame?.id,
    serverRoster,
    table,
  ]);
  const sharedActions = React.useMemo(
    () =>
      foldSharedGameActions(
        eventsOfGame(gameEvents, gameId),
        localActionEvents,
      ),
    [gameEvents, gameId, localActionEvents],
  );
  const rosterIds = React.useMemo(
    () => new Set((roster ?? []).map((person) => person.id)),
    [roster],
  );
  const appendAction = React.useCallback(
    (payload: SharedGameActionPayload): Promise<boolean> => {
      if (spectator || !gameId) return Promise.resolve(true);
      const clientId = generateUuidV4();
      const event: PartyGameEventInput = {
        clientId,
        kind: "action",
        payload,
        createdAt: new Date(stamp()).toISOString(),
      };
      const scope = gameScope;
      setLocalActionEvents((current) => [...current, event]);
      const rollback = () => {
        if (activeGameScopeRef.current !== scope) return;
        setLocalActionEvents((current) =>
          current.filter((pending) => pending.clientId !== clientId),
        );
      };
      return sendGameEvent(
        gameId,
        { kind: "action", payload, createdAt: event.createdAt },
        clientId,
      ).then((stored) => {
        if (stored === false) rollback();
        return stored !== false;
      }, () => {
        rollback();
        return false;
      });
    },
    [gameId, gameScope, sendGameEvent, spectator],
  );
  const sharedPromptStep = promptStep(sharedActions);
  const sharedCardDraws = cardDraws(sharedActions, KINGS_CARD_IDS);
  const sharedCardDrawActions = cardDrawActions(sharedActions, KINGS_CARD_IDS);
  const fourthKingDraw = (() => {
    let kings = 0;
    for (const draw of sharedCardDrawActions) {
      if (draw.value === "K" || draw.value.endsWith("-K")) kings += 1;
      if (kings === 4) return draw;
    }
    return null;
  })();
  // A local-only Kings deck keeps its cards inside DrawShell, so the fourth
  // king has to be mirrored here to take "Konec" off the table in time.
  // Resetting state during render (React's "adjusting state when a prop
  // changes" pattern): if the scope changed without a draw, store it with an
  // empty hand so returning to the old scope starts fresh.
  const [localKings, setLocalKings] = React.useState<{
    scope: string;
    cards: string[];
  }>({
    scope: "",
    cards: [],
  });
  if (localKings.scope !== gameScope) {
    setLocalKings({ scope: gameScope, cards: [] });
  }
  const localKingsCards = localKings.cards;
  const localKingsDrawerRef = React.useRef<{
    scope: string;
    playerId: string;
  } | null>(null);
  React.useEffect(() => {
    localKingsDrawerRef.current = null;
  }, [gameScope]);
  const localKingsDeckFinished =
    key === "kings" &&
    localKingsCards.filter((card) => card === "K" || card.endsWith("-K"))
      .length >= 4;
  const sharedDrawKind = def?.draw ?? "person";
  const sharedDraw = latestDraw(
    sharedActions,
    sharedDrawKind,
    sharedDrawKind === "person" ? rosterIds : KINGS_CARD_IDS,
  );
  const sharedPick = latestPick(sharedActions, rosterIds);
  const sharedPickRevision = pickRevision(sharedActions, rosterIds);
  const sharedDiceState = React.useMemo(
    () =>
      roster && gameId ? foldDiceActions(roster, sharedActions) : undefined,
    [gameId, roster, sharedActions],
  );
  const remoteFinish = canonicalGameFinish(eventsOfGame(gameEvents, gameId));
  const [localFinishState, setLocalFinishState] = React.useState<{
    scope: string;
    finish: CanonicalGameFinish;
  } | null>(null);
  const localFinish =
    localFinishState?.scope === gameScope ? localFinishState.finish : null;
  const canonicalFinish = remoteFinish ?? localFinish;
  const finishLocked = React.useRef<string | null>(null);
  // Latest-canonical mirrors: a round pick send can resolve long after the
  // table moved on, and its continuation must read the table as it is NOW,
  // not as the tap captured it.
  const sharedPickRef = React.useRef(sharedPick);
  const canonicalFinishRef = React.useRef(canonicalFinish);
  const canonicalRosterByIdRef = React.useRef(
    new Map((roster ?? []).map((player) => [player.id, player])),
  );
  React.useLayoutEffect(() => {
    sharedPickRef.current = sharedPick;
    canonicalFinishRef.current = canonicalFinish;
    canonicalRosterByIdRef.current = new Map(
      (roster ?? []).map((player) => [player.id, player]),
    );
  });
  // Holds the game scope while this phone's round pick send is still in
  // flight; a stale scope never matches, so a new game starts unguarded.
  // Cleanup also invalidates on unmount, so a late resolution can neither
  // clear nor finish a game this screen no longer shows.
  const roundPickPending = React.useRef<string | null>(null);
  React.useEffect(() => {
    roundPickPending.current = null;
    return () => {
      roundPickPending.current = null;
    };
  }, [gameScope]);
  const remoteAnswers = React.useMemo<QuizAnswer[]>(
    () =>
      eventsOfGame(gameEvents, gameId)
        .filter((event) => event.kind === "answer")
        .flatMap((event) => {
          const questionId = event.payload.questionId;
          const option = event.payload.option;
          if (typeof questionId !== "string" || typeof option !== "number")
            return [];
          return [
            {
              entrantId: event.account.id,
              questionId,
              option,
              at: new Date(event.at).getTime(),
              cursor: event.cursor,
            },
          ];
        }),
    [gameEvents, gameId],
  );
  const answers = React.useMemo(
    () => [...myAnswers, ...remoteAnswers],
    [myAnswers, remoteAnswers],
  );
  const sharedQuizProgress = quizProgress(sharedActions);
  const [localQuestion, setLocalQuestion] = React.useState(0);
  const [localRevealed, setLocalRevealed] = React.useState<number[]>([]);
  const question = gameId ? sharedQuizProgress.question : localQuestion;
  const forceRevealed = gameId
    ? sharedQuizProgress.forceRevealed
    : localRevealed.includes(localQuestion);
  const terminalResultPending = Boolean(
    gameId &&
      ((shell === "turns" && sharedDiceState?.payingId) ||
        (shell === "quiz" && question >= QUIZ_QUESTIONS.length)),
  );
  const localAnswerLocks = React.useRef(new Set<string>());

  const answer = (option: number) => {
    if (spectator) return;
    const current = QUIZ_QUESTIONS[question];
    const me = gameCurrentPlayerId;
    if (
      forceRevealed ||
      !current ||
      !me ||
      !entrants.some((entrant) => entrant.id === me)
    )
      return;
    const identity = `${me}\u0000${current.id}`;
    if (
      localAnswerLocks.current.has(identity) ||
      answers.some(
        (entry) => entry.entrantId === me && entry.questionId === current.id,
      )
    )
      return;
    localAnswerLocks.current.add(identity);
    const at = stamp();
    const optimisticAnswer = {
      entrantId: me,
      questionId: current.id,
      option,
      at,
    };
    setMyAnswers((list) =>
      // A team's answer is its first one, so a second tap is not an edit.
      list.some(
        (entry) => entry.entrantId === me && entry.questionId === current.id,
      )
        ? list
        : [...list, optimisticAnswer],
    );
    // …and to the table. Queued, so a pub with no signal costs nothing.
    if (gameId) {
      const scope = gameScope;
      const rollback = () => {
        localAnswerLocks.current.delete(identity);
        if (activeGameScopeRef.current !== scope) return;
        setMyAnswers((list) =>
          list.filter(
            (entry) =>
              !(
                entry.entrantId === optimisticAnswer.entrantId &&
                entry.questionId === optimisticAnswer.questionId &&
                entry.at === optimisticAnswer.at
              ),
          ),
        );
      };
      void sendGameEvent(gameId, {
        kind: "answer",
        payload: { questionId: current.id, option },
        createdAt: new Date(at).toISOString(),
      }).then((stored) => {
        if (stored === false) rollback();
      }, rollback);
    }
  };

  const scoreSignature = (subjectId: string, delta: number, at: string) =>
    `${subjectId}\u0000${delta}\u0000${Date.parse(at)}`;
  const serverScoreEvents = gameEvents.filter(
    (event) =>
      event.gameId === gameId && event.kind === "score" && event.subject,
  );
  const pendingLocalScores = React.useMemo(() => {
    const me = gameCurrentPlayerId;
    const acknowledgedClientIds = new Set<string>();
    const acknowledgements = new Map<string, number>();
    for (const event of serverScoreEvents) {
      if (!event.subject || event.account.id !== me) continue;
      if (event.clientId) acknowledgedClientIds.add(event.clientId);
      const signature = scoreSignature(event.subject.id, event.delta, event.at);
      acknowledgements.set(
        signature,
        (acknowledgements.get(signature) ?? 0) + 1,
      );
    }
    return localScoreEvents.filter((event) => {
      if (typeof event.id === "string" && acknowledgedClientIds.has(event.id))
        return false;
      const signature = scoreSignature(
        event.subjectId,
        event.delta,
        event.createdAt,
      );
      const remaining = acknowledgements.get(signature) ?? 0;
      if (remaining === 0) return true;
      acknowledgements.set(signature, remaining - 1);
      return false;
    });
  }, [gameCurrentPlayerId, localScoreEvents, serverScoreEvents]);
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
    if (spectator) return;
    const createdAt = new Date(stamp()).toISOString();
    const clientId = generateUuidV4();
    const optimisticScore = {
      id: clientId,
      subjectId: player.id,
      delta: 1,
      createdAt,
    };
    setLocalScoreEvents((current) => [...current, optimisticScore]);
    if (gameId) {
      const scope = gameScope;
      const rollback = () => {
        if (activeGameScopeRef.current !== scope) return;
        setLocalScoreEvents((current) =>
          current.filter((event) => event.id !== optimisticScore.id),
        );
      };
      void sendGameEvent(
        gameId,
        {
          kind: "score",
          subjectId: player.id,
          delta: 1,
          createdAt,
        },
        clientId,
      ).then((stored) => {
        if (stored === false) rollback();
      }, rollback);
    }
  };

  const ranked = (roster ?? [])
    .map((player) => ({ ...player, score: scoresById[player.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const leader = ranked[0];
  const played = ranked.some((row) => row.score > 0);

  // Error copy derived once — the same string is rendered and, when it first
  // becomes visible, announced.
  const sharingFailureLine =
    sharingFailure && roster && !spectator
      ? `Hra běží jen na tomhle telefonu. ${sharingFailure}`
      : null;
  const retryFailureLine =
    roster === null && !canonicalFinish && retryQuizRoster
      ? (sharingFailure ?? cs.gameHost.loadFailed)
      : null;

  /**
   * Screen reader announcements, iOS only.
   *
   * The visible error lines are already live regions, so Android picks them up
   * declaratively; iOS additionally speaks the full line once when it first
   * appears, keyed by content so an unrelated rerender never repeats it.
   */
  const announcedErrorRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    const line = sharingFailureLine ?? retryFailureLine;
    if (!line) {
      announcedErrorRef.current = null;
      return;
    }
    if (announcedErrorRef.current === line) return;
    announcedErrorRef.current = line;
    AccessibilityInfo.announceForAccessibility?.(line);
  });

  /**
   * Score changes are announced from the diff against the previous board —
   * mounted/reconnected values are the silent baseline, and the ref advances
   * on every platform and state so acknowledgements and reorders never repeat.
   */
  const previousScoresRef = React.useRef<Record<string, number> | null>(null);
  React.useEffect(() => {
    const current: Record<string, number> = {};
    for (const row of ranked) current[row.id] = row.score;
    const previous = previousScoresRef.current;
    previousScoresRef.current = current;
    if (
      Platform.OS !== "ios" ||
      previous === null ||
      spectator ||
      !roster ||
      canonicalFinish ||
      shell !== "score"
    )
      return;
    for (const row of ranked) {
      const before = previous[row.id];
      if (before !== undefined && before !== row.score)
        AccessibilityInfo.announceForAccessibility?.(
          scoreAccessibilityLabel(row.name, row.score),
        );
    }
  });

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
  const report = React.useCallback(
    (result: {
      winner: string | null;
      scores: { name: string; score: number }[];
      paying?: string | null;
      winnerId?: string | null;
      payingId?: string | null;
    }) => {
      if (
        spectator ||
        canonicalFinishRef.current ||
        finishLocked.current === gameScope
      )
        return Promise.resolve(false);
      finishLocked.current = gameScope;
      const payload = {
        winner: result.winner,
        scores: result.scores,
        ...(result.paying !== undefined ? { paying: result.paying } : {}),
        ...(result.winnerId !== undefined ? { winnerId: result.winnerId } : {}),
        ...(result.payingId !== undefined ? { payingId: result.payingId } : {}),
      };
      const finish: CanonicalGameFinish = {
        winnerId: result.winnerId ?? null,
        payingId: result.payingId ?? null,
        winner: result.winner,
        paying: result.paying ?? null,
        scores: result.scores,
      };
      const commit = (): boolean => {
        if (
          activeGameScopeRef.current !== gameScope ||
          canonicalFinishRef.current
        )
          return Boolean(canonicalFinishRef.current);
        setLocalFinishState({ scope: gameScope, finish });
        if (key) finishGame(key, { game: name, ...result });
        return true;
      };
      if (!gameId) {
        return Promise.resolve(commit());
      }
      return sendGameEvent(gameId, {
        kind: "finish",
        payload,
      }).then((stored) => {
        if (activeGameScopeRef.current !== gameScope) return false;
        if (stored === false) {
          if (finishLocked.current === gameScope) finishLocked.current = null;
          return false;
        }
        return commit();
      }, () => {
        if (
          activeGameScopeRef.current === gameScope &&
          finishLocked.current === gameScope
        )
          finishLocked.current = null;
        return false;
      });
    },
    [finishGame, gameId, gameScope, key, name, sendGameEvent, spectator],
  );

  React.useEffect(() => {
    if (
      key !== "kings" ||
      spectator ||
      canonicalFinish ||
      !fourthKingDraw
    )
      return undefined;
    // The payer is whoever the canonical draw names. When an old client drew
    // without an author, every phone falls back to the SAME roster member —
    // first by sorted id — instead of to whoever happens to hold this phone.
    const payer =
      (fourthKingDraw.drawnById
        ? roster?.find((player) => player.id === fourthKingDraw.drawnById)
        : undefined) ?? (roster ? deterministicFirstPlayer(roster) : null);
    if (!payer) return undefined;
    // The draw action is durable before this timer starts. A process death
    // comes back to the same canonical fourth king and schedules the same
    // first-finish-wins result; meanwhile the card remains visible.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const retryFinish = () => {
      timer = setTimeout(() => {
        void report({
        winner: null,
        winnerId: null,
        scores: [],
        paying: payer.name,
        payingId: payer.id,
        }).then((stored) => {
          if (!stored && !cancelled && !canonicalFinishRef.current) retryFinish();
        });
      }, 1600);
    };
    retryFinish();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [canonicalFinish, fourthKingDraw, key, report, roster, spectator]);

  const finish = () => {
    // The quiz scores itself from the answers, not from the "+1" score events
    // the other games use. Reporting `ranked` here handed the result screen a
    // row of zeros under a scoreboard that said otherwise.
    if (shell === "quiz") {
      void report(quizFinishResult(quizState({ entrants, answers, index: question })));
      return;
    }
    void report({
      // A drinking game names nobody, and keeps no tally: the only tally it
      // could keep is who drank most.
      winner: onPoints && played ? leader.name : null,
      winnerId: onPoints && played ? leader.id : null,
      scores: onPoints
        ? ranked.map(({ id, name: playerName, score }) => ({
            name: playerName,
            score,
            playerId: id,
          }))
        : [],
    });
  };
  if (invalidGame) return null;
  return (
    <View style={styles.screen}>
      {/* The night, pinned. Back on the left, tally and +1 on the right — the
          two things you reach for without looking away from the table. */}
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={leaveGame}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpátky do večera"
          hitSlop={6}
        >
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </Pressable>

        <Text
          style={styles.topTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
          accessibilityRole="header"
        >
          {name}
        </Text>

        {/* Ending is up here, as far from everything you tap during a game as
            the screen allows — and it is text, not a full-width amber bar
            competing with the button you actually press. */}
        {/* The right slot keeps its width even when Konec is hidden (finished
            game, spectator, fourth king) so the title never shifts. */}
        <View style={styles.endSlot}>
          {roster &&
          !canonicalFinish &&
          !spectator &&
          key !== "round" &&
          !terminalResultPending &&
          !fourthKingDraw &&
          !localKingsDeckFinished ? (
            <Pressable
              onPress={finish}
              style={({ pressed }) => [styles.end, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Ukončit hru"
              hitSlop={8}
            >
              <Text
                style={styles.endText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                Konec
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {spectator ? (
        <Text
          style={styles.spectatorNote}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {cs.gameHost.spectator}
        </Text>
      ) : null}

      {sharingFailureLine ? (
        <Text
          style={styles.sharingFailure}
          maxFontSizeMultiplier={FontScaleCap.body}
          accessibilityLiveRegion="assertive"
        >
          {sharingFailureLine}
        </Text>
      ) : null}

      {roster === null && !canonicalFinish && retryQuizRoster ? (
        <View style={styles.startFailure}>
          <Text
            style={styles.startFailureText}
            maxFontSizeMultiplier={FontScaleCap.body}
            accessibilityLiveRegion="assertive"
          >
            {retryFailureLine}
          </Text>
          <Pressable
            onPress={() => {
              void beginGame(retryQuizRoster);
            }}
            style={({ pressed }) => [
              styles.startRetry,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={cs.gameHost.retry}
          >
            <Text
              style={styles.startRetryText}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {cs.gameHost.retry}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {roster === null && !canonicalFinish && !retryQuizRoster ? (
        <GameLobby
          def={def}
          table={table}
          onStart={(selected) => {
            void beginGame(selected);
          }}
          onInvite={() => setInviteOpen(true)}
        />
      ) : null}

      {roster && canonicalFinish ? (
        <GameResult
          players={roster}
          outcome={{
            scores: canonicalFinish.scores.map((row) => ({
              playerId:
                canonicalResultReference(roster, row.playerId, row.name) ?? row.name,
              score: row.score,
            })),
            winnerId: canonicalResultReference(
              roster,
              canonicalFinish.winnerId,
              canonicalFinish.winner,
            ),
            payingId: canonicalResultReference(
              roster,
              canonicalFinish.payingId,
              canonicalFinish.paying,
            ),
          }}
          onDone={leaveGame}
        />
      ) : null}

      {roster && !canonicalFinish && shell === "turns" ? (
        <DiceDuelShell
          spectator={spectator}
          players={roster}
          state={sharedDiceState}
          onRoll={
            gameId
              ? ({ playerId, dice }) => {
                  void appendAction({ type: "dice_roll", playerId, dice });
                }
              : undefined
          }
          onNextRound={
            gameId ? () => void appendAction({ type: "dice_next" }) : undefined
          }
          // Dice already reported their canonical result before GameResult is
          // shown. This button only leaves; reporting again would overwrite the
          // payer and standings with the generic empty score.
          onDone={leaveGame}
          onFinished={(result) => {
            // The board is round wins. "Who paid" is the story, and it is the
            // line the recap and the feed lead with.
            return report({
              winner: null,
              winnerId: null,
              scores: result.standings,
              paying: result.paying,
              payingId: result.payingId,
            });
          }}
        />
      ) : null}

      {roster && key === "round" && !canonicalFinish ? (
        <RoundDrumShell
          spectator={spectator}
          players={roster}
          pickedId={sharedPick?.playerId ?? null}
          bottomInset={insets.bottom}
          // Variant B: a native slowing drum, then the platform result. The
          // stable id is published with the name so duplicate display names
          // can never turn into an empty or wrong payer.
          onPicked={(payingId) => {
            // The canonical pick on the table wins: a second spin after
            // another phone's pick landed must never rename the payer.
            const resolvedId = sharedPick?.playerId ?? payingId;
            const payer = roster.find((player) => player.id === resolvedId);
            if (!payer) return;
            const result = {
              winner: null,
              winnerId: null,
              scores: [],
              paying: payer.name,
              payingId: payer.id,
            };
            // Local-only round finishes synchronously, as it always did.
            if (!gameId) {
              void report(result);
              return;
            }
            // One spin per round: a double tap while the pick send is still
            // in flight can neither bypass the wait nor enqueue twice.
            if (roundPickPending.current === gameScope) return;
            if (sharedPick) {
              return report(result);
            }
            const scope = gameScope;
            roundPickPending.current = scope;
            return appendAction({
              type: "pick",
              playerId: payer.id,
              fromRevision: sharedPickRevision,
            })
              .then((stored) => {
                if (stored === false) {
                  if (roundPickPending.current === scope)
                    roundPickPending.current = null;
                  return;
                }
                // The canonical pick is durably enqueued; only now may the
                // finish follow, so another phone sees the payer first.
                if (roundPickPending.current !== scope) return;
                roundPickPending.current = null;
                // The table moved on while the send was in flight: a remote
                // finish wins outright, and a canonical remote pick names the
                // payer — this phone's spin was too late either way.
                if (canonicalFinishRef.current) return;
                const resolvedId =
                  sharedPickRef.current?.playerId ?? payer.id;
                const resolvedPayer =
                  canonicalRosterByIdRef.current.get(resolvedId);
                if (!resolvedPayer) return;
                return report({
                  winner: null,
                  winnerId: null,
                  scores: [],
                  paying: resolvedPayer.name,
                  payingId: resolvedPayer.id,
                });
              })
              .catch(() => {
                if (roundPickPending.current === scope)
                  roundPickPending.current = null;
              });
          }}
        />
      ) : null}

      {roster && !canonicalFinish && shell === "pick" && key !== "round" ? (
        <PickShell
          spectator={spectator}
          game="bottle"
          players={roster}
          action="Roztoč"
          verdict={(name) =>
            key === "bottle"
              ? `${name} je na řadě`
              : name === "Ty"
                ? "Platíš ty"
                : `Platí ${name}`
          }
          // Flaška keeps going until the table has had enough.
          onDone={undefined}
          pickedId={gameId ? (sharedPick?.playerId ?? null) : undefined}
          pickRevision={gameId ? sharedPickRevision : undefined}
          onPicked={
            gameId
              ? (playerId) => {
                  void appendAction({
                    type: "pick",
                    playerId,
                    fromRevision: sharedPickRevision,
                  });
                }
              : undefined
          }
        />
      ) : null}

      {roster && !canonicalFinish && shell === "quiz" ? (
        <QuizShell
          spectator={spectator}
          entrants={entrants}
          answers={answers}
          me={gameCurrentPlayerId ?? "me"}
          index={question}
          tintOf={(playerId) =>
            roster.find((person) => person.id === playerId)?.tint ?? Colors.amber
          }
          forceRevealed={forceRevealed}
          onAnswer={(option) => answer(option)}
          onReveal={() => {
            if (gameId) void appendAction({ type: "quiz_reveal", question });
            else setLocalRevealed((current) => [...current, question]);
          }}
          onNext={() => {
            if (gameId)
              void appendAction({ type: "quiz_next", fromQuestion: question });
            else setLocalQuestion((current) => current + 1);
          }}
          onFinished={(result) => {
            if (!key) return Promise.resolve(false);
            return report({
              winner: result.winner,
              winnerId: result.winnerId,
              scores: result.standings,
            });
          }}
          onDone={leaveGame}
        />
      ) : null}

      {roster && !canonicalFinish && shell === "prompt" ? (
        <PromptShell
          spectator={spectator}
          prompts={prompts}
          intro={def?.intro}
          seed={seed}
          step={gameId ? sharedPromptStep : undefined}
          onNext={
            gameId
              ? () =>
                  void appendAction({
                    type: "prompt_next",
                    fromStep: sharedPromptStep,
                  })
              : undefined
          }
        />
      ) : null}

      {roster && !canonicalFinish && shell === "draw" ? (
        <DrawShell
          spectator={spectator}
          kind={def?.draw ?? "person"}
          players={roster}
          intro={def?.intro}
          action={DRAW_ACTION[def?.draw ?? "person"]}
          seed={seed}
          result={
            gameId && sharedDraw
              ? {
                  nonce: sharedDraw.clientId,
                  ...(sharedDraw.drawKind === "person"
                    ? { personId: sharedDraw.value }
                    : { cardId: sharedDraw.value }),
                }
              : gameId
                ? null
                : undefined
          }
          drawnCardIds={
            gameId && (def?.draw ?? "person") === "card"
              ? sharedCardDraws
              : undefined
          }
          onDraw={
            gameId
              ? (result) => {
                  const drawKind = def?.draw ?? "person";
                  const value =
                    drawKind === "person" ? result.personId : result.cardId;
                  if (value)
                    void appendAction({
                      type: "draw",
                      drawKind,
                      value,
                      fromCount:
                        drawKind === "card"
                          ? sharedCardDraws.length
                          : undefined,
                      drawnById:
                        roster[sharedCardDraws.length % roster.length]?.id ??
                        gameCurrentPlayerId,
                    });
                }
              : (result) => {
                  // Local Kings only: mirror the drawn cards so the header can
                  // pull "Konec" the moment the fourth king lands, before
                  // DrawShell's own delayed payer report.
                  if (key === "kings" && result.cardId) {
                    const drawer =
                      roster[localKingsCards.length % roster.length];
                    if (drawer) {
                      localKingsDrawerRef.current = {
                        scope: gameScope,
                        playerId: drawer.id,
                      };
                    }
                    setLocalKings((current) =>
                      current.scope === gameScope
                        ? {
                            ...current,
                            cards: [...current.cards, result.cardId!],
                          }
                        : { scope: gameScope, cards: [result.cardId!] },
                    );
                  }
                }
          }
          onDeckFinished={
            key === "kings" && !gameId
              ? () => {
                  const payer =
                    (localKingsDrawerRef.current?.scope === gameScope
                      ? roster.find(
                          (player) =>
                            player.id ===
                            localKingsDrawerRef.current?.playerId,
                        )
                      : undefined) ?? roster[0];
                  if (!payer) return;
                  void report({
                    winner: null,
                    winnerId: null,
                    scores: [],
                    paying: payer?.name ?? null,
                    payingId: payer?.id ?? null,
                  });
                }
              : undefined
          }
        />
      ) : null}

      {roster && !canonicalFinish && shell === "score" ? (
        <ScrollView
          contentContainerStyle={[
            styles.body,
            { paddingBottom: insets.bottom + 120 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* The rules, on the screen. Nobody remembers how King's Cup goes and
            looking it up mid-round is how a game dies. */}
          {def ? (
            <Text
              style={styles.rules}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {def.how}
            </Text>
          ) : null}
          <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
            {onPoints
              ? "Ťukni na toho, kdo bodoval."
              : "Ťukni na toho, kdo dostal bod."}
          </Text>

          {ranked.map((row, index) => (
            <Pressable
              key={row.id}
              onPress={() => bump(row)}
              disabled={spectator}
              style={({ pressed }) => [
                styles.player,
                onPoints && index === 0 && played && styles.playerLeader,
                pressed && !spectator && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={scoreAccessibilityLabel(row.name, row.score)}
              accessibilityLiveRegion="polite"
              accessibilityState={{ disabled: spectator }}
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
      {roster && !canonicalFinish ? (
        <Pressable
          onPress={() => beer.add(houseBeer)}
          style={({ pressed }) => [
            styles.counter,
            { bottom: insets.bottom + Spacing.sm },
            pressed && styles.counterPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.partyGameBeerCounter(
            beerCountLabel(beerCount),
          )}
          hitSlop={6}
        >
          <BeerIcon size={18} color={Colors.stout} />
          <Text
            style={[
              styles.counterText,
              Platform.OS === "android" && styles.counterTextAndroid,
            ]}
            allowFontScaling={false}
          >
            {beerCount}
          </Text>
          <PlusIcon size={15} color={Colors.stout} />
        </Pressable>
      ) : null}
      <InviteSheet
        visible={inviteOpen}
        present={table.map((person) => person.id)}
        code={sharedCode}
        link={eveningLink}
        onClose={() => setInviteOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  pressed: { opacity: 0.7 },

  top: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.1),
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(Colors.foam, 0.08),
    marginLeft: -6,
  },
  topTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: Colors.foam,
    letterSpacing: -0.2,
  },
  end: {
    width: 44,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  endSlot: {
    width: 44,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  endText: { fontSize: 15, fontWeight: "700", color: Colors.mutedText },
  spectatorNote: {
    paddingHorizontal: MockLayout.screenPad,
    paddingVertical: Spacing.sm,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.mutedText,
  },
  sharingFailure: {
    paddingHorizontal: MockLayout.screenPad,
    paddingVertical: Spacing.sm,
    fontSize: 13,
    fontWeight: "600",
    color: Colors.amber,
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  startFailure: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    paddingHorizontal: MockLayout.screenPad,
  },
  startFailureText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.mutedText,
    textAlign: "center",
  },
  startRetry: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  startRetryText: { fontSize: 15, fontWeight: "800", color: Colors.stout },
  counter: {
    position: "absolute",
    right: MockLayout.screenPad,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  counterPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  counterText: {
    fontFamily: Fonts.numeral,
    fontSize: 19,
    lineHeight: 24,
    includeFontPadding: false,
    color: Colors.stout,
    fontVariant: ["tabular-nums"],
  },
  counterTextAndroid: { transform: [{ translateY: 3 }] },

  body: {
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.lg,
    gap: Spacing.sm,
  },
  rules: {
    fontSize: 15,
    fontWeight: "500",
    color: Colors.foam,
    lineHeight: 21,
  },
  hint: {
    fontSize: 14,
    fontWeight: "400",
    color: Colors.mutedText,
    marginBottom: Spacing.sm,
  },

  player: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: HitArea.min + 22,
    paddingHorizontal: Spacing.lg,
    borderRadius: 22,
    backgroundColor: MockColors.surfaceHigh,
  },
  playerLeader: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  playerName: { flex: 1, fontSize: 20, fontWeight: "700", color: Colors.foam },
  playerScore: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.foam,
    fontVariant: ["tabular-nums"],
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  finishText: { ...MockType.buttonLabel, color: Colors.stout },
});
