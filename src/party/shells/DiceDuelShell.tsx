/**
 * Kostky, played round by round, with the phone passed around.
 *
 * The screen only ever says ONE thing: whose turn it is. A phone in the middle
 * of a table has to be readable by whoever it is being slid towards, so the name
 * is 34pt and the dice are the size of real ones. Everything else — the ladder,
 * who is already safe — sits under it, quiet, because it is context and not the
 * question.
 *
 * Three beats, and each one gets its own screen rather than being crammed
 * together:
 *
 *   turn     "Honza hází" and a button
 *   result   the dice land, the round's rolls line up, highest and lowest named
 *   over     who is safe, and who is buying
 *
 * The rules live WITH the game, in `src/games/web/dice/rules.ts`, and the page
 * runs them. This file draws words from the state snapshots the game sends —
 * whose turn it is, the round's rolls, the ladder — so the logic is in one
 * place and the text is still real text.
 *
 * The same rules module is imported here for one case only: when there is no
 * canvas at all (reduced motion, or a build without the WebView). One set of
 * rules, two hosts, never two implementations.
 */

import React from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PersonAvatar } from "@/components/shared/PersonAvatar";
import {
  GAME_HOST_AVAILABLE,
  GameHost,
  type GameHostHandle,
} from "@/games/GameHost";
import { GameResult } from "@/games/GameResult";
import { t } from "@/i18n";
import { displayPersonName, ME_NAME } from "@/party/nightBuilder";
import { DurableFinishPending, useDurableFinish } from "@/party/shells/DurableFinish";
import {
  isOver,
  recordRoll,
  roundLoser,
  roundWinners,
  settleRound,
  standings,
  startDice,
  total,
  whoseTurn,
  TARGET_WINS,
  type DicePlayer,
  type DiceState,
} from "@/games/web/dice/rules";
import {
  GameStage,
  STAGE_FILL,
  StageChip,
  StagePill,
  StageStatus,
  stageBody,
} from "@/party/shells/GameStage";
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { Radius, Spacing } from "@/theme/layout";

/**
 * The fallback roll, for reduced motion only.
 *
 * Everywhere else the physics decides — see `DiceCanvas`. Module scope because
 * `react-hooks/purity` flags `Math.random()` anywhere in a component body, and
 * it is right to: it cannot tell a handler from render.
 */
function throwDice(): [number, number] {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

/**
 * What the table shouts when the dice stop.
 *
 * Only the two ends get a line — a twelve and a snake eyes are events, and
 * everything between them is just a number. Saying something every single throw
 * is how a game starts feeling like a slot machine.
 */
function callFor(name: string, sum: number): string | null {
  if (sum === 12) return t.gameShell.diceTwelve(name);
  if (sum === 2) return t.gameShell.diceSnakeEyes(name);
  if (sum >= 10) return t.gameShell.diceHigh(name, sum);
  return null;
}

/** Bounds an optimistic lock whose canonical roll never arrives. */
const LOCK_RECOVERY_MS = 1200;

export function DiceDuelShell({
  players,
  onFinished,
  onDone,
  state: sharedState,
  onRoll,
  onNextRound,
  spectator = false,
}: {
  players: (DicePlayer & { name: string })[];
  /** Fired once, when the bill has an owner. */
  onFinished: (result: {
    payingId: string;
    paying: string;
    standings: { playerId: string; name: string; score: number }[];
  }) => Promise<boolean>;
  /** Leaving the finished game — the platform decides where that goes. */
  onDone: () => void;
  /** Folded append-only state. Omit for a local-only game. */
  state?: DiceState;
  onRoll?: (result: { playerId: string; dice: [number, number] }) => void;
  onNextRound?: () => void;
  /** Watch-only view of a shared game: canonical state stays visible, taps do not. */
  spectator?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [localState, setLocalState] = React.useState<DiceState>(() =>
    startDice(players),
  );
  const state = sharedState ?? localState;
  const controlled = sharedState !== undefined;
  const [rolling, setRolling] = React.useState(false);
  const interactionLocked = React.useRef(false);
  const fallbackUnlock = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** The current cheer's timeout; a new settled beat replaces, not stacks. */
  const cheerTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const turn = whoseTurn(state);
  const roundDone = turn === null && state.round.length > 0;
  const over = isOver(state);
  React.useEffect(() => {
    interactionLocked.current = false;
    if (fallbackUnlock.current) {
      clearTimeout(fallbackUnlock.current);
      fallbackUnlock.current = null;
    }
  }, [state.round.length, state.roundNumber]);

  React.useEffect(
    () => () => {
      if (fallbackUnlock.current) clearTimeout(fallbackUnlock.current);
      if (cheerTimer.current) clearTimeout(cheerTimer.current);
    },
    [],
  );

  const finishPayer = over
    ? players.find((player) => player.id === state.payingId)
    : undefined;
  // `isOver` and the dice rules guarantee one remaining payer. Keep the guard
  // here so malformed restored state cannot publish an empty finish.
  const finishResult = finishPayer
    ? {
        payingId: finishPayer.id,
        paying: finishPayer.name,
        standings: standings(state).map((row) => ({
          ...row,
          name:
            players.find((player) => player.id === row.playerId)?.name ??
            t.gameShell.unknownPlayer,
        })),
      }
    : null;
  const durableFinish = useDurableFinish({
    finished: over,
    spectator,
    resultKey: finishResult ? JSON.stringify(finishResult) : null,
    result: finishResult,
    onFinished,
  });

  const canvas = React.useRef<GameHostHandle>(null);
  const [cheer, setCheer] = React.useState<string | null>(null);

  /** Canvas-less play: the same rules, run here, because there is no page. */
  const localOnly = reduceMotion || !GAME_HOST_AVAILABLE;

  React.useEffect(() => {
    if (controlled) canvas.current?.command("sync", state);
  }, [controlled, state]);

  const roll = () => {
    if (spectator || rolling || interactionLocked.current || !turn) return;
    interactionLocked.current = true;
    if (localOnly) {
      const dice = throwDice();
      const player = players.find((candidate) => candidate.id === turn);
      if (controlled) {
        if (player) {
          onRoll?.({ playerId: player.id, dice });
          // Canonical state advances us; bound the lock in case it never does.
          if (fallbackUnlock.current) clearTimeout(fallbackUnlock.current);
          fallbackUnlock.current = setTimeout(() => {
            interactionLocked.current = false;
          }, LOCK_RECOVERY_MS);
        } else {
          interactionLocked.current = false;
        }
      } else {
        setLocalState((current) => recordRoll(current, turn, dice));
      }
      return;
    }
    setRolling(true);
    canvas.current?.command("roll");
  };

  const nextRound = () => {
    if (spectator) return;
    if (controlled) {
      onNextRound?.();
      return;
    }
    if (localOnly) {
      setLocalState((current) => settleRound(current));
      return;
    }
    canvas.current?.command("next");
  };

  // A beat of noise for what just landed. The state itself arrives separately.
  const settled = (payload: { dice: number[]; playerId: string }) => {
    const sum = (payload.dice[0] ?? 1) + (payload.dice[1] ?? 1);
    setRolling(false);
    interactionLocked.current = false;
    const player = players.find(
      (candidate) => candidate.id === payload.playerId,
    );
    if (cheerTimer.current) clearTimeout(cheerTimer.current);
    setCheer(callFor(displayPersonName(player?.name ?? t.gameShell.unknownPlayer), sum));
    if (controlled && payload.dice.length === 2) {
      const left = payload.dice[0];
      const right = payload.dice[1];
      if (
        player &&
        Number.isInteger(left) &&
        left >= 1 &&
        left <= 6 &&
        Number.isInteger(right) &&
        right >= 1 &&
        right <= 6
      ) {
        onRoll?.({ playerId: player.id, dice: [left, right] });
      }
    }
    cheerTimer.current = setTimeout(() => {
      cheerTimer.current = null;
      setCheer(null);
    }, 1600);
  };

  const last = state.round[state.round.length - 1];
  const playerOf = (playerId: string | null) =>
    players.find((player) => player.id === playerId) ?? null;
  const tintOf = (playerId: string) => playerOf(playerId)?.tint ?? Colors.amber;
  /** For the screen only: the finish result keeps the stored name. */
  const nameOf = (playerId: string | null) =>
    displayPersonName(playerOf(playerId)?.name ?? t.gameShell.unknownPlayer);
  const winners = roundWinners(state);
  const loser = roundLoser(state);
  // Derived once, read twice: the screen shows the pieces, VoiceOver hears
  // them joined into a single round announcement.
  const verdictLine =
    winners.length > 1
      ? t.gameShell.roundWinners(winners.map(nameOf).join(t.gameShell.nameJoiner))
      : t.gameShell.roundWinner(nameOf(winners[0] ?? null));
  const loserLine =
    loser && !winners.includes(loser)
      ? t.gameShell.lowestRoll(nameOf(loser))
      : null;
  const roundAnnouncement = loserLine
    ? `${verdictLine} ${loserLine}`
    : verdictLine;
  const turnLine =
    playerOf(turn)?.name === ME_NAME
      ? t.gameShell.yourTurnRoll
      : t.gameShell.turnRoll(nameOf(turn));

  const announcedTurn = React.useRef(turn);
  React.useEffect(() => {
    if (!turn || roundDone || over) {
      announcedTurn.current = turn;
      return;
    }
    if (announcedTurn.current === turn) return;
    announcedTurn.current = turn;
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility?.(turnLine);
    }
  }, [turn, turnLine, roundDone, over]);

  const announcedRound = React.useRef<number | null>(
    roundDone ? state.roundNumber : null,
  );
  React.useEffect(() => {
    if (!roundDone) {
      announcedRound.current = null;
      return;
    }
    if (announcedRound.current === state.roundNumber) return;
    announcedRound.current = state.roundNumber;
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility?.(roundAnnouncement);
    }
  }, [roundDone, state.roundNumber, roundAnnouncement]);

  const announcedCheer = React.useRef<string | null>(cheer);
  React.useEffect(() => {
    if (!cheer) {
      announcedCheer.current = null;
      return;
    }
    if (announcedCheer.current === cheer) return;
    announcedCheer.current = cheer;
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility?.(cheer);
    }
  }, [cheer]);

  if (over) {
    if (finishResult && durableFinish.status !== "stored") {
      return (
        <DurableFinishPending
          status={durableFinish.status}
          spectator={spectator}
          onRetry={durableFinish.retry}
        />
      );
    }
    // The shared ending — the same screen every game lands on, chosen from the
    // data rather than drawn again here.
    return (
      <GameResult
        players={players}
        outcome={{
          scores: standings(state).map((row) => ({
            playerId: row.playerId,
            score: row.score,
          })),
          winnerId: null,
          // Corrupt-state containment, not the normal game path: a restored
          // payingId outside the roster names nobody, so pass null rather
          // than dress a stranger up as the payer. The finish effect above
          // already refuses to publish such a payer.
          payingId: players.some((player) => player.id === state.payingId)
            ? state.payingId
            : null,
        }}
        // Who got out, in the order they managed it. The ladder is the story of
        // this game, not the raw win counts.
        board={state.safe.map((playerId, index) => ({
          playerId,
          name: nameOf(playerId),
          score: index + 1,
          suffix: `${index + 1}.`,
        }))}
        onDone={onDone}
      />
    );
  }

  // One screen, one table. The round summary lays itself over a GameHost that
  // stays mounted — remounting the WebView between rounds costs far more than
  // covering it for a beat, so the host only ever unmounts when the game ends.
  return (
    <View style={stageBody(insets.bottom)}>
      <GameStage
        topLeft={
          <StageChip
            label={
              roundDone
                ? `${state.roundNumber}. kolo`
                : `${state.roundNumber}. kolo · ${TARGET_WINS}× a jsi z obliga`
            }
          />
        }
      >
        {/* A real table: the dice fall, bounce off the rails and come to rest
            crooked, and whatever is on top is the answer. They stay where they
            landed while the next thrower decides — dice do not vanish between
            throws. */}
        <View style={styles.canvas} pointerEvents={roundDone ? "none" : "auto"}>
          {!localOnly ? (
            <GameHost
              ref={canvas}
              game="dice"
              players={players.map((player) => ({
                id: player.id,
                colour: player.tint,
              }))}
              // GameHost keeps these latest props across its own retry. Supplying
              // local state too means a restarted WebView resumes the current
              // round instead of silently opening a fresh game.
              options={{ count: 2, state }}
              // The game runs the rules; this is where its state arrives.
              onState={(next) => {
                if (!controlled) setLocalState(next as DiceState);
              }}
              onEvent={(name, payload) => {
                if (spectator || name !== "settled") return;
                settled(payload as { dice: number[]; playerId: string });
              }}
              onError={() => {
                interactionLocked.current = false;
                setRolling(false);
              }}
            />
          ) : last ? (
            <View style={styles.fallbackWrap}>
              <Text style={styles.fallbackDice} allowFontScaling={false}>
                {last.dice[0]} + {last.dice[1]}
              </Text>
            </View>
          ) : null}
        </View>

        {/* The call, over the table. An RN layer rather than text inside the
            page: it stays real text — Dynamic Type, VoiceOver, the app's own
            font — while looking like it landed on the felt.

            It goes the moment the round is settled: the summary that covers the
            table is translucent, so the shout stayed legible underneath it and
            said the same name twice, once loud and once as a ghost. */}
        {cheer && !roundDone ? (
          <Animated.View
            key={cheer}
            entering={FadeIn.duration(180)}
            exiting={FadeOut.duration(220)}
            style={styles.cheer}
            pointerEvents="none"
          >
            <Text
              style={styles.cheerText}
              maxFontSizeMultiplier={FontScaleCap.heading}
              accessibilityLiveRegion="polite"
            >
              {cheer}
            </Text>
          </Animated.View>
        ) : null}

        {/* The round, settled: what everybody threw, as the two numbers that
            decided it, laid over the table the dice are still sitting on. */}
        {roundDone ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(200)}
            style={styles.summary}
          >
            <View style={styles.rolls}>
              {[...state.round]
                .sort((a, b) => total(b) - total(a))
                .map((entry) => (
                  <View
                    key={entry.playerId}
                    style={[
                      styles.rollRow,
                      winners.includes(entry.playerId) && styles.rollRowWin,
                    ]}
                  >
                    <PersonAvatar
                      name={nameOf(entry.playerId)}
                      tint={tintOf(entry.playerId)}
                      size={30}
                    />
                    <Text style={styles.rollName} numberOfLines={1}>
                      {nameOf(entry.playerId)}
                    </Text>
                    <Text style={styles.rollDice} allowFontScaling={false}>
                      {entry.dice[0]} + {entry.dice[1]}
                    </Text>
                    <Text style={styles.rollTotal} allowFontScaling={false}>
                      {total(entry)}
                    </Text>
                  </View>
                ))}
            </View>
          </Animated.View>
        ) : null}
      </GameStage>

      {roundDone ? (
        <StageStatus
          name={nameOf(winners[0] ?? null)}
          tint={tintOf(winners[0] ?? "")}
          text={verdictLine}
          sub={loserLine}
          accessibilityLabel={roundAnnouncement}
        />
      ) : (
        <StageStatus
          name={nameOf(turn)}
          tint={tintOf(turn ?? "")}
          text={turnLine}
          role="header"
        />
      )}

      <Ladder state={state} tintOf={tintOf} nameOf={nameOf} />

      <View style={styles.dock}>
        <StagePill
          label={roundDone ? t.gameShell.nextRound : rolling ? "…" : t.gameShell.roll}
          onPress={roundDone ? nextRound : roll}
          disabled={spectator || (!roundDone && rolling)}
          tone={spectator ? "muted" : "primary"}
          accessibilityLabel={
            roundDone ? t.gameShell.nextRound : t.gameShell.rollFor(nameOf(turn))
          }
        />
      </View>
    </View>
  );
}

/** The ladder, as chips: who is safe, and how close everybody else is. */
function Ladder({
  state,
  tintOf,
  nameOf,
}: {
  state: DiceState;
  tintOf: (playerId: string) => string;
  nameOf: (playerId: string) => string;
}) {
  return (
    <View style={styles.ladder}>
      {state.players.map((player) => {
        const wins = state.wins[player.id] ?? 0;
        const safe = state.safe.includes(player.id);
        return (
          <View
            key={player.id}
            style={[styles.ladderChip, safe && styles.ladderChipSafe]}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${nameOf(player.id)} ${wins} z ${TARGET_WINS}`}
          >
            <PersonAvatar
              name={nameOf(player.id)}
              tint={tintOf(player.id)}
              size={22}
            />
            <Text
              style={[styles.ladderName, safe && styles.ladderSafe]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {nameOf(player.id)}
            </Text>
            <View style={styles.pips}>
              {Array.from({ length: TARGET_WINS }).map((_, index) => (
                <View
                  key={index}
                  style={[styles.pip, index < wins && styles.pipOn]}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  /** The canvas owns the whole playfield; the stage owns its frame. */
  canvas: STAGE_FILL,
  fallbackWrap: {
    ...STAGE_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackDice: {
    fontFamily: Fonts.numeral,
    fontSize: 56,
    lineHeight: 69,
    includeFontPadding: false,
    color: Colors.foam,
  },
  cheer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Spacing.md,
    alignItems: "center",
  },
  cheerText: {
    fontSize: 26,
    fontWeight: "800",
    color: Colors.foam,
    letterSpacing: -0.4,
    textShadowColor: Colors.stout,
    textShadowRadius: 12,
  },

  /**
   * The settled round, laid over the table.
   *
   * `display: none` on the canvas gave the WebView a zero frame, and WKWebView
   * throws away a page it is not drawing — so every round summary used to cost
   * a full reload and the table came back on "Načítám hru…". Covering it keeps
   * the page mounted, its real size, and already rendered for the next round.
   */
  summary: {
    ...STAGE_FILL,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    backgroundColor: withAlpha(Colors.stout, 0.88),
  },

  ladder: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  ladderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  ladderChipSafe: { backgroundColor: withAlpha(Colors.amber, 0.18) },
  ladderName: {
    maxWidth: 120,
    fontSize: 14,
    fontWeight: "600",
    color: withAlpha(Colors.foam, 0.75),
  },
  ladderSafe: { color: Colors.amber },
  pips: { flexDirection: "row", gap: 5 },
  pip: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: withAlpha(Colors.foam, 0.14),
  },
  pipOn: { backgroundColor: Colors.amber },

  rolls: { alignSelf: "stretch", gap: Spacing.xs },
  rollRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    height: 56,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
  },
  rollRowWin: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  rollName: { flex: 1, fontSize: 16, fontWeight: "700", color: Colors.foam },
  rollDice: { fontSize: 14, fontWeight: "600", color: Colors.mutedText },
  /** The two numbers that decided the round, at the size they deserve. */
  rollTotal: {
    minWidth: 42,
    textAlign: "right",
    fontFamily: Fonts.numeral,
    fontSize: 30,
    lineHeight: 37,
    includeFontPadding: false,
    color: Colors.foam,
  },

  dock: { marginTop: "auto", paddingTop: Spacing.lg },
});
