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
 * The rules live in `diceDuel.ts` with tests. This file only draws them — a game
 * whose ending is wrong is worse than no game, and that is not something to
 * verify by playing it in a simulator.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Face } from '@/feed/FeedMockScreen';
import { DICE_CANVAS_AVAILABLE, DiceCanvas, type DiceCanvasHandle } from '@/party/DiceCanvas';
import {
  isOver,
  recordRoll,
  roundLoser,
  roundWinners,
  settleRound,
  startDice,
  total,
  whoseTurn,
  TARGET_WINS,
  type DicePlayer,
  type DiceState,
} from '@/party/diceDuel';
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

export function DiceDuelShell({
  players,
  onFinished,
}: {
  players: DicePlayer[];
  /** Fired once, when the bill has an owner. */
  onFinished: (result: { paying: string | null; standings: { name: string; score: number }[] }) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [state, setState] = React.useState<DiceState>(() => startDice(players));
  const [rolling, setRolling] = React.useState(false);
  const reported = React.useRef(false);

  const turn = whoseTurn(state);
  const roundDone = turn === null && state.round.length > 0;
  const over = isOver(state);

  React.useEffect(() => {
    if (over && !reported.current) {
      reported.current = true;
      onFinished({ paying: state.paying, standings: standingsOf(state) });
    }
  }, [over, state, onFinished]);

  const canvas = React.useRef<DiceCanvasHandle>(null);

  const roll = () => {
    if (rolling || !turn) return;
    // No table to watch — reduced motion, or a build without the WebView — so
    // no throw to wait for. The game still plays; it just does not show off.
    if (reduceMotion || !DICE_CANVAS_AVAILABLE) {
      setState((current) => recordRoll(current, turn, throwDice()));
      return;
    }
    setRolling(true);
    canvas.current?.roll();
  };

  // What the dice actually landed on, straight from the simulation. Nothing
  // decided these numbers in advance, which is the whole point.
  const settled = (dice: number[]) => {
    const thrower = whoseTurn(state);
    if (!thrower) return;
    setState((current) => recordRoll(current, thrower, [dice[0] ?? 1, dice[1] ?? 1]));
    setRolling(false);
  };

  const last = state.round[state.round.length - 1];
  const tintOf = (name: string) =>
    players.find((player) => player.name === name)?.tint ?? Colors.amber;

  if (over) {
    return <DiceOver state={state} tintOf={tintOf} />;
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
                <Face name={entry.name} tint={tintOf(entry.name)} size={30} />
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
          onPress={() => setState((current) => settleRound(current))}
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
        <Face name={turn ?? ''} tint={tintOf(turn ?? '')} size={64} />
        <Text style={styles.turnName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {turn === 'Ty' ? 'Házíš ty' : `${turn} hází`}
        </Text>
      </View>

      {/* A real table: the dice fall, bounce off the rails and come to rest
          crooked, and whatever is on top is the answer. They stay where they
          landed while the next thrower decides — dice do not vanish between
          throws. */}
      <View style={styles.dice}>
        {DICE_CANVAS_AVAILABLE ? (
          <DiceCanvas ref={canvas} count={2} onSettled={settled} />
        ) : last ? (
          <Text style={styles.fallbackDice} allowFontScaling={false}>
            {last.dice[0]} + {last.dice[1]}
          </Text>
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
            <Face name={player.name} tint={tintOf(player.name)} size={22} />
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

function DiceOver({ state, tintOf }: { state: DiceState; tintOf: (name: string) => string }) {
  return (
    <Animated.View entering={FadeIn.duration(260)} style={styles.body}>
      <Text style={styles.kicker} maxFontSizeMultiplier={FontScaleCap.body}>
        Dohráno
      </Text>

      {state.paying ? (
        <View style={styles.payer}>
          <Face name={state.paying} tint={tintOf(state.paying)} size={72} />
          <Text style={styles.payerName} maxFontSizeMultiplier={FontScaleCap.heading}>
            {state.paying === 'Ty' ? 'Platíš ty' : `Platí ${state.paying}`}
          </Text>
          <Text style={styles.payerSub} maxFontSizeMultiplier={FontScaleCap.body}>
            Rundu pro stůl. Zasloužil sis to.
          </Text>
        </View>
      ) : (
        <View style={styles.payer}>
          <Text style={styles.payerName} maxFontSizeMultiplier={FontScaleCap.heading}>
            Nikdo neplatí
          </Text>
          <Text style={styles.payerSub} maxFontSizeMultiplier={FontScaleCap.body}>
            Dostali jste se z toho všichni. To se jen tak nevidí.
          </Text>
        </View>
      )}

      <View style={styles.rolls}>
        {state.safe.map((name, index) => (
          <View key={name} style={styles.rollRow}>
            <Face name={name} tint={tintOf(name)} size={30} />
            <Text style={styles.rollName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.rollTotal} allowFontScaling={false}>
              {index + 1}.
            </Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function standingsOf(state: DiceState) {
  return state.players
    .map((player) => ({ name: player.name, score: state.wins[player.name] ?? 0 }))
    .sort((a, b) => b.score - a.score);
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
