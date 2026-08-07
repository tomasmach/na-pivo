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

/** Kostky has its own turn-based table now, so nothing draws dice here. */
export type DrawKind = 'person' | 'card';

/** Long enough to be a moment, short enough that nobody puts the phone down. */
const ROLL_MS = 900;

/** Module scope so `react-hooks/purity` can see these are taps, not render. */
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

export interface DrawPlayer {
  id: string;
  name: string;
}

export interface DrawResult {
  /** Bumped on every draw so a repeat still re-animates and re-announces. */
  nonce: string;
  personId?: string;
  cardId?: string;
}

export function DrawShell({
  kind,
  players,
  intro,
  /** Label on the button. "Roztoč", "Hoď", "Táhni" — the verb is the game. */
  action,
  result,
  onDraw,
}: {
  kind: DrawKind;
  players: DrawPlayer[];
  intro?: string;
  action: string;
  /** Latest folded shared result. Omit for local-only state. */
  result?: DrawResult | null;
  onDraw?: (result: DrawResult) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [localResult, setLocalResult] = React.useState<DrawResult | null>(null);
  const [rolling, setRolling] = React.useState(false);
  const shown = result === undefined ? localResult : result;
  const shownPlayer = players.find((player) => player.id === shown?.personId);
  const shownCard = KINGS_CARDS.find((card) => card.card === shown?.cardId);

  const spin = useSharedValue(0);
  const settle = useSharedValue(1);

  const draw = () => {
    if (rolling) return;
    // Chosen first, animated to second. The animation is decoration over an
    // answer that already exists, which is what keeps reduced motion honest.
    const next: DrawResult = { nonce: String(Date.now()) };
    if (kind === 'person') next.personId = pick(players)?.id;
    else next.cardId = pick(KINGS_CARDS)?.card;

    const publish = () => {
      if (result === undefined) setLocalResult(next);
      onDraw?.(next);
    };

    if (reduceMotion) {
      publish();
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
    // Persist the game's chosen answer immediately. Animation is theatre; a
    // process death halfway through it must not erase the draw.
    publish();
    setTimeout(() => {
      setRolling(false);
    }, ROLL_MS);
  };

  const settleStyle = useAnimatedStyle(() => ({ transform: [{ scale: settle.value }] }));

  return (
    <View style={styles.wrap}>
      {intro && !shown ? (
        <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
          {intro}
        </Text>
      ) : null}

      <View style={styles.stage}>
        {kind === 'person' ? (
          <Animated.View style={settleStyle}>
            {rolling ? (
              // Names racing past. Not a spinner: you can see it is choosing
              // between the people actually at the table.
              <RollingNames players={players} />
            ) : (
              <Text
                key={shown?.nonce}
                style={styles.person}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {shownPlayer?.name ?? '…'}
              </Text>
            )}
          </Animated.View>
        ) : null}

        {kind === 'card' ? (
          <Animated.View style={[styles.card, settleStyle]}>
            {rolling || !shownCard ? (
              <Text style={styles.cardBack} allowFontScaling={false}>
                ?
              </Text>
            ) : (
              <Animated.View key={shown?.nonce} entering={FadeIn.duration(200)}>
                <Text style={styles.cardRank} allowFontScaling={false}>
                  {shownCard.card}
                </Text>
                <Text style={styles.cardTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {shownCard.title}
                </Text>
                <Text style={styles.cardRule} maxFontSizeMultiplier={FontScaleCap.body}>
                  {shownCard.rule}
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
          {rolling ? '…' : shown ? 'Znovu' : action}
        </Text>
      </Pressable>
    </View>
  );
}

/** The names, cycling, while the wheel is still turning. */
function RollingNames({ players }: { players: DrawPlayer[] }) {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => setIndex((current) => current + 1), 80);
    return () => clearInterval(id);
  }, []);

  return (
    <Text style={[styles.person, styles.personRolling]} numberOfLines={1} allowFontScaling={false}>
      {players[index % players.length]?.name ?? '…'}
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
