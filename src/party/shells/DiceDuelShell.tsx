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
  Pressable,
  ScrollView,
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
import { MockColors, MockLayout, MockType } from "@/mocks/mockTheme";
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
  if (sum === 12) return `${name} má dvanáct!`;
  if (sum === 2) return `${name}… dvě. Au.`;
  if (sum >= 10) return `${name} ${sum}`;
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
            "Hráč",
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
    setCheer(callFor(player?.name ?? "Hráč", sum));
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
  const nameOf = (playerId: string | null) =>
    playerOf(playerId)?.name ?? "Hráč";
  const winners = roundWinners(state);
  const loser = roundLoser(state);
  // Derived once, read twice: the screen shows the pieces, VoiceOver hears
  // them joined into a single round announcement.
  const verdictLine =
    winners.length > 1
      ? `${winners.map(nameOf).join(" a ")} berou kolo`
      : `${nameOf(winners[0] ?? null)} bere kolo`;
  const loserLine =
    loser && !winners.includes(loser)
      ? `Nejmíň hodil ${nameOf(loser)}.`
      : null;
  const roundAnnouncement = loserLine
    ? `${verdictLine} ${loserLine}`
    : verdictLine;
  const turnLine =
    playerOf(turn)?.name === "Ty" ? "Házíš ty" : `${nameOf(turn)} hází`;

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

  // One screen, one table. The round summary swaps in around a GameHost that
  // stays mounted — remounting the WebView between rounds costs far more than
  // hiding it for a beat, so the host only ever unmounts when the game ends.
  return (
    <ScrollView
      contentContainerStyle={[
        styles.body,
        { paddingBottom: insets.bottom + 88 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text
        key="kicker"
        style={styles.kicker}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {roundDone
          ? `${state.roundNumber}. kolo`
          : `${state.roundNumber}. kolo · ${TARGET_WINS}× a jsi z obliga`}
      </Text>

      {roundDone ? (
        <React.Fragment key="summary">
          <Text
            style={styles.verdict}
            maxFontSizeMultiplier={FontScaleCap.heading}
            accessibilityLiveRegion="polite"
            accessibilityLabel={roundAnnouncement}
          >
            {verdictLine}
          </Text>
          {loserLine ? (
            <Text
              style={styles.verdictSub}
              maxFontSizeMultiplier={FontScaleCap.body}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              {loserLine}
            </Text>
          ) : null}

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

          <Pressable
            onPress={nextRound}
            disabled={spectator}
            style={({ pressed }) => [
              styles.action,
              pressed && !spectator && styles.pressed,
              spectator && styles.muted,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Další kolo"
            accessibilityState={{ disabled: spectator }}
          >
            <Text
              style={styles.actionText}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              Další kolo
            </Text>
          </Pressable>
        </React.Fragment>
      ) : (
        <View key="turn" style={styles.turn}>
          <PersonAvatar
            name={nameOf(turn)}
            tint={tintOf(turn ?? "")}
            size={64}
          />
          <Text
            style={styles.turnName}
            numberOfLines={2}
            maxFontSizeMultiplier={FontScaleCap.heading}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {turnLine}
          </Text>
        </View>
      )}

      {/* A real table: the dice fall, bounce off the rails and come to rest
          crooked, and whatever is on top is the answer. They stay where they
          landed while the next thrower decides — dice do not vanish between
          throws. Hidden, not gone, while the round summary shows. */}
      <View
        key="dice"
        style={[styles.dice, roundDone && styles.diceHidden]}
        pointerEvents={roundDone ? "none" : "auto"}
      >
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
          <Text style={styles.fallbackDice} allowFontScaling={false}>
            {last.dice[0]} + {last.dice[1]}
          </Text>
        ) : null}

        {/* The call, over the table. An RN layer rather than text inside the
            page: it stays real text — Dynamic Type, VoiceOver, the app's own
            font — while looking like it landed on the felt. */}
        {cheer ? (
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
      </View>

      {!roundDone ? (
        <React.Fragment key="play">
          {/* Smaller than the dice, because the dice ARE the screen. A full-width
              amber bar under them made the button the loudest thing in a game whose
              whole point is what just landed. */}
          <Pressable
            onPress={roll}
            disabled={rolling || spectator}
            style={({ pressed }) => [
              styles.roll,
              (pressed || rolling) && !spectator && styles.pressed,
              spectator && styles.muted,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Hodit za ${nameOf(turn)}`}
            accessibilityState={{ disabled: Boolean(rolling || spectator) }}
          >
            <Text
              style={styles.actionText}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {rolling ? "…" : "Hoď"}
            </Text>
          </Pressable>

          <Ladder state={state} tintOf={tintOf} nameOf={nameOf} />
        </React.Fragment>
      ) : null}
    </ScrollView>
  );
}

/** The ladder, quiet, under the turn — context, not the question. */
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
          <View key={player.id} style={styles.ladderRow}>
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
  body: {
    flexGrow: 1,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.lg,
    alignItems: "center",
  },
  pressed: { opacity: 0.8 },
  kicker: { fontSize: 13, fontWeight: "700", color: Colors.mutedText },
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
    textShadowColor: MockColors.bg,
    textShadowRadius: 12,
  },

  turn: { alignItems: "center", gap: Spacing.sm, marginTop: Spacing.xl },
  turnName: {
    fontSize: 34,
    fontWeight: "800",
    color: Colors.foam,
    letterSpacing: -0.6,
    textAlign: "center",
  },

  dice: {
    alignSelf: "stretch",
    height: 260,
    marginTop: Spacing.md,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  /**
   * Out of the way between rounds, but never out of the layout.
   *
   * `display: none` gave the WebView a zero frame, and WKWebView throws away a
   * page it is not drawing — so every round summary cost a full reload and the
   * table came back on "Načítám hru…". Absolute and transparent keeps it its
   * real size, mounted and already rendered when the next round starts.
   */
  diceHidden: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    opacity: 0,
    marginTop: 0,
  },
  roll: {
    height: 54,
    paddingHorizontal: 44,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xl,
    backgroundColor: Colors.amber,
  },
  muted: { backgroundColor: withAlpha(Colors.amber, 0.35) },

  action: {
    alignSelf: "stretch",
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xl,
    backgroundColor: Colors.amber,
  },
  actionText: { ...MockType.buttonLabel, color: Colors.stout },

  ladder: { alignSelf: "stretch", marginTop: Spacing.xl, gap: Spacing.sm },
  ladderRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  ladderName: {
    flex: 1,
    fontSize: 15,
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

  verdict: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "800",
    color: Colors.foam,
    textAlign: "center",
    marginTop: Spacing.md,
    letterSpacing: -0.5,
  },
  verdictSub: {
    fontSize: 15,
    fontWeight: "500",
    color: Colors.mutedText,
    marginTop: Spacing.xs,
  },

  rolls: { alignSelf: "stretch", marginTop: Spacing.xl, gap: Spacing.xs },
  rollRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    height: 52,
    paddingHorizontal: Spacing.md,
    borderRadius: 18,
    backgroundColor: MockColors.surfaceHigh,
  },
  rollRowWin: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  rollName: { flex: 1, fontSize: 16, fontWeight: "700", color: Colors.foam },
  rollDice: { fontSize: 14, fontWeight: "600", color: Colors.mutedText },
  rollTotal: {
    minWidth: 34,
    textAlign: "right",
    fontFamily: Fonts.numeral,
    fontSize: 20,
    lineHeight: 25,
    includeFontPadding: false,
    color: Colors.foam,
  },

  payer: { alignItems: "center", gap: Spacing.sm, marginTop: Spacing.xxl },
  payerName: {
    fontSize: 32,
    fontWeight: "800",
    color: Colors.amber,
    letterSpacing: -0.5,
  },
  payerSub: {
    fontSize: 15,
    fontWeight: "500",
    color: Colors.mutedText,
    textAlign: "center",
  },
});
