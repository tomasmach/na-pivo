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

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { GAME_HOST_AVAILABLE, GameHost, type GameHostHandle } from '@/games/GameHost';
import { GameResult } from '@/games/GameResult';
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
} from '@/games/web/dice/rules';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

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

export function DiceDuelShell({
  players,
  onFinished,
  onDone,
  state: sharedState,
  onRoll,
  onNextRound,
}: {
  players: (DicePlayer & { id: string })[];
  /** Fired once, when the bill has an owner. */
  onFinished: (result: { paying: string | null; standings: { name: string; score: number }[] }) => void;
  /** Leaving the finished game — the platform decides where that goes. */
  onDone: () => void;
  /** Folded append-only state. Omit for a local-only game. */
  state?: DiceState;
  onRoll?: (result: { playerId: string; dice: [number, number] }) => void;
  onNextRound?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [localState, setLocalState] = React.useState<DiceState>(() => startDice(players));
  const state = sharedState ?? localState;
  const controlled = sharedState !== undefined;
  const [rolling, setRolling] = React.useState(false);
  const reported = React.useRef(false);

  const turn = whoseTurn(state);
  const roundDone = turn === null && state.round.length > 0;
  const over = isOver(state);

  React.useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      onFinished({ paying: state.paying, standings: standings(state) });
    }
  }, [over, state, onFinished]);

  const canvas = React.useRef<GameHostHandle>(null);
  const [cheer, setCheer] = React.useState<string | null>(null);

  /** Canvas-less play: the same rules, run here, because there is no page. */
  const localOnly = reduceMotion || !GAME_HOST_AVAILABLE;

  React.useEffect(() => {
    if (controlled) canvas.current?.command('sync', state);
  }, [controlled, state]);

  const roll = () => {
    if (rolling || !turn) return;
    if (localOnly) {
      const dice = throwDice();
      const player = players.find((candidate) => candidate.name === turn);
      if (controlled) {
        if (player) onRoll?.({ playerId: player.id, dice });
      } else {
        setLocalState((current) => recordRoll(current, turn, dice));
      }
      return;
    }
    setRolling(true);
    canvas.current?.command('roll');
  };

  const nextRound = () => {
    if (controlled) {
      onNextRound?.();
      return;
    }
    if (localOnly) {
      setLocalState((current) => settleRound(current));
      return;
    }
    canvas.current?.command('next');
  };

  // A beat of noise for what just landed. The state itself arrives separately.
  const settled = (payload: { dice: number[]; playerId: string }) => {
    const sum = (payload.dice[0] ?? 1) + (payload.dice[1] ?? 1);
    setRolling(false);
    setCheer(callFor(payload.playerId, sum));
    if (controlled && payload.dice.length === 2) {
      const player = players.find((candidate) => candidate.name === payload.playerId);
      const left = payload.dice[0];
      const right = payload.dice[1];
      if (
        player &&
        Number.isInteger(left) && left >= 1 && left <= 6 &&
        Number.isInteger(right) && right >= 1 && right <= 6
      ) {
        onRoll?.({ playerId: player.id, dice: [left, right] });
      }
    }
    setTimeout(() => setCheer(null), 1600);
  };

  const last = state.round[state.round.length - 1];
  const tintOf = (name: string) =>
    players.find((player) => player.name === name)?.tint ?? Colors.amber;



  if (over) {
    // The shared ending — the same screen every game lands on, chosen from the
    // data rather than drawn again here.
    return (
      <GameResult
        players={players}
        outcome={{
          scores: standings(state).map((row) => ({ playerId: row.name, score: row.score })),
          winnerId: null,
          payingId: state.paying,
        }}
        // Who got out, in the order they managed it. The ladder is the story of
        // this game, not the raw win counts.
        board={state.safe.map((name, index) => ({
          name,
          score: index + 1,
          suffix: `${index + 1}.`,
        }))}
        onDone={onDone}
      />
    );
  }

  if (roundDone) {
    const winners = roundWinners(state);
    const loser = roundLoser(state);
    return (
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker} maxFontSizeMultiplier={FontScaleCap.body}>
          {state.roundNumber}. kolo
        </Text>
        <Text style={styles.verdict} maxFontSizeMultiplier={FontScaleCap.heading}>
          {winners.length > 1 ? `${winners.join(' a ')} berou kolo` : `${winners[0]} bere kolo`}
        </Text>
        {loser && !winners.includes(loser) ? (
          <Text style={styles.verdictSub} maxFontSizeMultiplier={FontScaleCap.body}>
            Nejmíň hodil {loser}.
          </Text>
        ) : null}

        <View style={styles.rolls}>
          {[...state.round]
            .sort((a, b) => total(b) - total(a))
            .map((entry) => (
              <View
                key={entry.name}
                style={[styles.rollRow, winners.includes(entry.name) && styles.rollRowWin]}
              >
                <PersonAvatar name={entry.name} tint={tintOf(entry.name)} size={30} />
                <Text style={styles.rollName} numberOfLines={1}>
                  {entry.name}
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
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Další kolo"
        >
          <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Další kolo
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <View style={styles.body}>
      <Text style={styles.kicker} maxFontSizeMultiplier={FontScaleCap.body}>
        {state.roundNumber}. kolo · {TARGET_WINS}× a jsi z obliga
      </Text>

      <View style={styles.turn}>
        <PersonAvatar name={turn ?? ''} tint={tintOf(turn ?? '')} size={64} />
        <Text style={styles.turnName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {turn === 'Ty' ? 'Házíš ty' : `${turn} hází`}
        </Text>
      </View>

      {/* A real table: the dice fall, bounce off the rails and come to rest
          crooked, and whatever is on top is the answer. They stay where they
          landed while the next thrower decides — dice do not vanish between
          throws. */}
      <View style={styles.dice}>
        {GAME_HOST_AVAILABLE ? (
          <GameHost
            ref={canvas}
            game="dice"
            // The id IS the name here: this game is local to one phone, and the
            // shell already guarantees names are unique at a table.
            players={players.map((player) => ({ id: player.name, colour: player.tint }))}
            options={{ count: 2, ...(controlled ? { state } : {}) }}
            // The game runs the rules; this is where its state arrives.
            onState={(next) => {
              if (!controlled) setLocalState(next as DiceState);
            }}
            onEvent={(name, payload) => {
              if (name === 'settled') settled(payload as { dice: number[]; playerId: string });
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
            <Text style={styles.cheerText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cheer}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      {/* Smaller than the dice, because the dice ARE the screen. A full-width
          amber bar under them made the button the loudest thing in a game whose
          whole point is what just landed. */}
      <Pressable
        onPress={roll}
        disabled={rolling}
        style={({ pressed }) => [styles.roll, (pressed || rolling) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Hodit za ${turn}`}
      >
        <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {rolling ? '…' : 'Hoď'}
        </Text>
      </Pressable>

      <Ladder state={state} tintOf={tintOf} />
    </View>
  );
}

/** The ladder, quiet, under the turn — context, not the question. */
function Ladder({ state, tintOf }: { state: DiceState; tintOf: (name: string) => string }) {
  return (
    <View style={styles.ladder}>
      {state.players.map((player) => {
        const wins = state.wins[player.name] ?? 0;
        const safe = state.safe.includes(player.name);
        return (
          <View key={player.name} style={styles.ladderRow}>
            <PersonAvatar name={player.name} tint={tintOf(player.name)} size={22} />
            <Text
              style={[styles.ladderName, safe && styles.ladderSafe]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {player.name}
            </Text>
            <View style={styles.pips}>
              {Array.from({ length: TARGET_WINS }).map((_, index) => (
                <View key={index} style={[styles.pip, index < wins && styles.pipOn]} />
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
    flex: 1,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.lg,
    alignItems: 'center',
  },
  pressed: { opacity: 0.8 },
  kicker: { fontSize: 13, fontWeight: '700', color: Colors.mutedText },
  fallbackDice: { fontFamily: Fonts.numeral, fontSize: 56, color: Colors.foam },
  cheer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.md,
    alignItems: 'center',
  },
  cheerText: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.4,
    textShadowColor: MockColors.bg,
    textShadowRadius: 12,
  },

  turn: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xl },
  turnName: { fontSize: 34, fontWeight: '800', color: Colors.foam, letterSpacing: -0.6 },

  dice: { alignSelf: 'stretch', height: 260, marginTop: Spacing.md },
  roll: {
    height: 54,
    paddingHorizontal: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    backgroundColor: Colors.amber,
  },

  action: {
    alignSelf: 'stretch',
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    backgroundColor: Colors.amber,
  },
  actionText: { ...MockType.buttonLabel, color: Colors.stout },

  ladder: { alignSelf: 'stretch', marginTop: Spacing.xl, gap: Spacing.sm },
  ladderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ladderName: { flex: 1, fontSize: 15, fontWeight: '600', color: withAlpha(Colors.foam, 0.75) },
  ladderSafe: { color: Colors.amber },
  pips: { flexDirection: 'row', gap: 5 },
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
    fontWeight: '800',
    color: Colors.foam,
    textAlign: 'center',
    marginTop: Spacing.md,
    letterSpacing: -0.5,
  },
  verdictSub: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.mutedText,
    marginTop: Spacing.xs,
  },

  rolls: { alignSelf: 'stretch', marginTop: Spacing.xl, gap: Spacing.xs },
  rollRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 52,
    paddingHorizontal: Spacing.md,
    borderRadius: 18,
    backgroundColor: MockColors.surfaceHigh,
  },
  rollRowWin: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  rollName: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.foam },
  rollDice: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },
  rollTotal: {
    minWidth: 34,
    textAlign: 'right',
    fontFamily: Fonts.numeral,
    fontSize: 20,
    color: Colors.foam,
  },

  payer: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xxl },
  payerName: { fontSize: 32, fontWeight: '800', color: Colors.amber, letterSpacing: -0.5 },
  payerSub: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
