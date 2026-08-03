/**
 * A deck of prompts, one card at a time.
 *
 * Three of the eight games are this: "Nikdy jsem…", "Kategorie", "Pravidlo
 * večera". They differ only in what is written on the cards.
 *
 * The card is the whole screen on purpose. A phone in the middle of a pub table
 * is read by five people at arm's length in bad light, so the prompt is 30pt and
 * everything else gets out of its way — no header, no chrome, no explanation
 * repeated under it. You tap anywhere to deal the next one, which is the one
 * gesture that survives being drunk.
 *
 * The deck is SHUFFLED once and then dealt through, rather than picking at
 * random each time. Random repeats, and a repeat two cards apart is the moment
 * a table decides the app is broken. When it runs out it reshuffles and says so.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { MockLayout } from '@/mocks/mockTheme';
import { Spacing } from '@/theme/layout';

/**
 * A deterministic shuffle, seeded by the deck itself.
 *
 * `Math.random()` in render is impure and the lint rule is right to stop it;
 * this runs once, in a state initialiser, and gives a different order per game
 * because the seed comes from the prompts and the length.
 */
function shuffled(items: readonly string[], seed: number): string[] {
  const deck = [...items];
  let state = seed || 1;
  for (let index = deck.length - 1; index > 0; index -= 1) {
    // xorshift: small, deterministic, and nobody has to trust a dependency.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const pick = Math.abs(state) % (index + 1);
    [deck[index], deck[pick]] = [deck[pick], deck[index]];
  }
  return deck;
}

export function PromptShell({
  prompts,
  intro,
  seed,
}: {
  prompts: readonly string[];
  intro?: string;
  /** Varies the order between games without calling `Math.random()` in render. */
  seed: number;
}) {
  const reduceMotion = useReducedMotion();
  const [deck, setDeck] = React.useState(() => shuffled(prompts, seed));
  const [index, setIndex] = React.useState(0);
  // A single-card deck is a rule, not a round — no counter, no "další".
  const single = prompts.length <= 1;

  const next = () => {
    if (single) return;
    setIndex((current) => {
      if (current + 1 < deck.length) return current + 1;
      // Round the deck rather than stopping. A table that is still playing does
      // not want to be told the game is over.
      setDeck(shuffled(prompts, seed + current + 1));
      return 0;
    });
  };

  return (
    <Pressable
      onPress={next}
      style={styles.wrap}
      accessibilityRole={single ? 'text' : 'button'}
      accessibilityLabel={single ? deck[index] : `${deck[index]}. Ťukni pro další.`}
    >
      {intro ? (
        <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
          {intro}
        </Text>
      ) : null}

      <Animated.View
        // Keyed by the card, so React unmounts one and mounts the next — which
        // is what makes the cross-fade a card change rather than text swapping
        // inside a box.
        key={`${index}-${deck[index]}`}
        entering={reduceMotion ? undefined : FadeIn.duration(220)}
        exiting={reduceMotion ? undefined : FadeOut.duration(140)}
        style={styles.card}
      >
        <Text style={styles.prompt} maxFontSizeMultiplier={FontScaleCap.heading}>
          {deck[index]}
        </Text>
      </Animated.View>

      {single ? null : (
        <View style={styles.foot}>
          <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
            Ťukni kamkoliv
          </Text>
          <Text style={styles.count} allowFontScaling={false}>
            {index + 1}/{deck.length}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: MockLayout.screenPad,
  },
  intro: {
    fontSize: 15,
    fontWeight: '600',
    color: withAlpha(Colors.foam, 0.5),
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  card: { justifyContent: 'center' },
  prompt: {
    fontSize: 30,
    lineHeight: 40,
    fontWeight: '800',
    color: Colors.foam,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  foot: {
    position: 'absolute',
    left: MockLayout.screenPad,
    right: MockLayout.screenPad,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: { fontSize: 14, fontWeight: '600', color: withAlpha(Colors.foam, 0.35) },
  count: {
    fontFamily: Fonts.numeral,
    fontSize: 15,
    color: withAlpha(Colors.foam, 0.35),
    fontVariant: ['tabular-nums'],
  },
});
