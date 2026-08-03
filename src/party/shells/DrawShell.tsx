/**
 * Chance, drawn: dice, a person, a card off the top.
 *
 * The three games that come down to "the app decides" — Kostky, Flaška, Kdo
 * platí rundu, King's Cup. What makes them worth opening a phone for is not the
 * answer, which anyone could get by counting on fingers; it is the SUSPENSE
 * before it. So none of them just prints a result: the dice tumble, the names
 * race past and slow down, the card turns over. That half second is the game.
 *
 * All three land on a value chosen up front and then animate TO it, rather than
 * animating and reading off whatever they hit. Otherwise reduced motion — where
 * there is no animation to read off — would need its own second implementation,
 * and the two would drift.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { KINGS_CARDS } from '@/party/gameContent';
import { MockColors, MockLayout } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export type DrawKind = 'dice' | 'person' | 'card';

/** Long enough to be a moment, short enough that nobody puts the phone down. */
const ROLL_MS = 900;

interface Result {
  /** Bumped on every draw so a repeat still re-animates and re-announces. */
  nonce: number;
  dice?: [number, number];
  person?: string;
  card?: (typeof KINGS_CARDS)[number];
}

export function DrawShell({
  kind,
  players,
  intro,
  /** Label on the button. "Roztoč", "Hoď", "Táhni" — the verb is the game. */
  action,
}: {
  kind: DrawKind;
  players: string[];
  intro?: string;
  action: string;
}) {
  const reduceMotion = useReducedMotion();
  const [result, setResult] = React.useState<Result | null>(null);
  const [rolling, setRolling] = React.useState(false);

  const spin = useSharedValue(0);
  const settle = useSharedValue(1);

  const draw = () => {
    if (rolling) return;
    // Chosen first, animated to second. The animation is decoration over an
    // answer that already exists, which is what keeps reduced motion honest.
    const next: Result = { nonce: Date.now() };
    if (kind === 'dice') {
      next.dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
    } else if (kind === 'person') {
      next.person = players[Math.floor(Math.random() * players.length)];
    } else {
      next.card = KINGS_CARDS[Math.floor(Math.random() * KINGS_CARDS.length)];
    }

    if (reduceMotion) {
      setResult(next);
      return;
    }

    setRolling(true);
    spin.value = 0;
    settle.value = 0.8;
    spin.value = withTiming(1, { duration: ROLL_MS, easing: Easing.out(Easing.cubic) });
    settle.value = withSequence(
      withTiming(0.8, { duration: ROLL_MS - 160 }),
      // The little overshoot at the end is the whole trick: it reads as the
      // thing coming to rest rather than the screen changing.
      withTiming(1.08, { duration: 110 }),
      withTiming(1, { duration: 90 }),
    );
    setTimeout(() => {
      setResult(next);
      setRolling(false);
    }, ROLL_MS);
  };

  const tumbleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 720}deg` }, { scale: settle.value }],
  }));
  const settleStyle = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));

  return (
    <View style={styles.wrap}>
      {intro && !result ? (
        <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
          {intro}
        </Text>
      ) : null}

      <View style={styles.stage}>
        {kind === 'dice' ? (
          <Animated.View style={[styles.dice, tumbleStyle]}>
            {(result?.dice ?? [1, 1]).map((pips, index) => (
              <View key={index} style={[styles.die, rolling && styles.dieRolling]}>
                <Text style={styles.diePips} allowFontScaling={false}>
                  {rolling ? '·' : pips}
                </Text>
              </View>
            ))}
          </Animated.View>
        ) : null}

        {kind === 'person' ? (
          <Animated.View style={settleStyle}>
            {rolling ? (
              // Names racing past. Not a spinner: you can see it is choosing
              // between the people actually at the table.
              <RollingNames players={players} />
            ) : (
              <Text
                key={result?.nonce}
                style={styles.person}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {result?.person ?? '…'}
              </Text>
            )}
          </Animated.View>
        ) : null}

        {kind === 'card' ? (
          <Animated.View style={[styles.card, settleStyle]}>
            {rolling || !result?.card ? (
              <Text style={styles.cardBack} allowFontScaling={false}>
                ?
              </Text>
            ) : (
              <Animated.View key={result.nonce} entering={FadeIn.duration(200)}>
                <Text style={styles.cardRank} allowFontScaling={false}>
                  {result.card.card}
                </Text>
                <Text style={styles.cardTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {result.card.title}
                </Text>
                <Text style={styles.cardRule} maxFontSizeMultiplier={FontScaleCap.body}>
                  {result.card.rule}
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        ) : null}
      </View>

      <Pressable
        onPress={draw}
        disabled={rolling}
        style={({ pressed }) => [styles.action, (pressed || rolling) && styles.actionPressed]}
        accessibilityRole="button"
        accessibilityLabel={action}
      >
        <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {rolling ? '…' : result ? 'Znovu' : action}
        </Text>
      </Pressable>
    </View>
  );
}

/** The names, cycling, while the wheel is still turning. */
function RollingNames({ players }: { players: string[] }) {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => setIndex((current) => current + 1), 80);
    return () => clearInterval(id);
  }, []);

  return (
    <Text style={[styles.person, styles.personRolling]} numberOfLines={1} allowFontScaling={false}>
      {players[index % players.length]}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', paddingHorizontal: MockLayout.screenPad },
  intro: {
    fontSize: 15,
    fontWeight: '600',
    color: withAlpha(Colors.foam, 0.5),
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  stage: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },

  dice: { flexDirection: 'row', gap: Spacing.md },
  die: {
    width: 96,
    height: 96,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  dieRolling: { backgroundColor: withAlpha(Colors.amber, 0.35) },
  diePips: { fontFamily: Fonts.numeral, fontSize: 48, color: Colors.stout },

  person: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    color: Colors.foam,
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  personRolling: { color: withAlpha(Colors.foam, 0.45) },

  card: {
    width: 260,
    minHeight: 200,
    padding: Spacing.lg,
    borderRadius: 24,
    justifyContent: 'center',
    backgroundColor: MockColors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  cardBack: {
    fontFamily: Fonts.numeral,
    fontSize: 64,
    color: withAlpha(Colors.foam, 0.2),
    textAlign: 'center',
  },
  cardRank: { fontFamily: Fonts.numeral, fontSize: 34, color: Colors.amber },
  cardTitle: { fontSize: 20, fontWeight: '800', color: Colors.foam, marginTop: 2 },
  cardRule: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
    color: withAlpha(Colors.foam, 0.72),
    marginTop: Spacing.sm,
  },

  action: {
    height: 60,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xl,
    backgroundColor: Colors.amber,
  },
  actionPressed: { opacity: 0.85 },
  actionText: { fontSize: 17, fontWeight: '800', color: Colors.stout },
});
