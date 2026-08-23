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

import React from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { MockLayout } from "@/mocks/mockTheme";
import { Spacing } from "@/theme/layout";

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

export function promptDeck(
  items: readonly string[],
  seed: number,
  cycle: number,
  previous?: string,
): string[] {
  const deck = shuffled(items, seed + cycle * Math.max(1, items.length));
  if (deck.length > 1 && previous !== undefined && deck[0] === previous) {
    [deck[0], deck[1]] = [deck[1], deck[0]];
  }
  return deck;
}

/** Long enough to cover a slow round trip, short enough that the card frees up. */
const LOCK_RECOVERY_MS = 1200;

export function PromptShell({
  prompts,
  intro,
  seed,
  step,
  onNext,
  spectator = false,
}: {
  prompts: readonly string[];
  intro?: string;
  /** Varies the order between games without calling `Math.random()` in render. */
  seed: number;
  /** Shared append-only position. Omit for a local-only game. */
  step?: number;
  onNext?: () => void;
  /** Read-only view: the card shows, but nobody advances the deck from here. */
  spectator?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [localStep, setLocalStep] = React.useState(0);
  const currentStep = step ?? localStep;
  const pendingStep = React.useRef<number | null>(null);
  // Bounds an optimistic lock whose canonical step never arrives — a dropped
  // callback or a lost race must not freeze the deck until remount.
  const pendingUnlock = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (pendingStep.current !== currentStep) {
      pendingStep.current = null;
      if (pendingUnlock.current) {
        clearTimeout(pendingUnlock.current);
        pendingUnlock.current = null;
      }
    }
  }, [currentStep]);
  React.useEffect(
    () => () => {
      if (pendingUnlock.current) clearTimeout(pendingUnlock.current);
    },
    [],
  );
  const cycle =
    prompts.length > 0 ? Math.floor(currentStep / prompts.length) : 0;
  const deck = React.useMemo(() => {
    const previous =
      cycle > 0 ? promptDeck(prompts, seed, cycle - 1).at(-1) : undefined;
    return promptDeck(prompts, seed, cycle, previous);
  }, [cycle, prompts, seed]);
  const index = deck.length > 0 ? currentStep % deck.length : 0;
  // A single-card deck is a rule, not a round — no counter, no "další".
  const single = prompts.length <= 1;

  // iOS has no accessibilityLiveRegion, so each new card is announced
  // imperatively — exactly the text on the card, nothing invented. The ref
  // starts at the current step: mounting never announces, only real advances.
  const announcedStep = React.useRef(currentStep);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (announcedStep.current === currentStep) return;
    const prompt = deck[index];
    if (!prompt) return;
    announcedStep.current = currentStep;
    AccessibilityInfo.announceForAccessibility?.(prompt);
  }, [currentStep, deck, index]);

  const next = () => {
    if (spectator || single || pendingStep.current === currentStep) return;
    pendingStep.current = currentStep;
    if (onNext) {
      const atPress = currentStep;
      if (pendingUnlock.current) clearTimeout(pendingUnlock.current);
      pendingUnlock.current = setTimeout(() => {
        if (pendingStep.current === atPress) pendingStep.current = null;
      }, LOCK_RECOVERY_MS);
      onNext();
    } else {
      setLocalStep((current) => current + 1);
    }
  };

  const card = (
    <>
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
        <Text
          style={styles.prompt}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {deck[index]}
        </Text>
      </Animated.View>

      {single ? null : (
        <View style={[styles.foot, { bottom: insets.bottom + 88 }]}>
          {spectator ? null : (
            <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
              Ťukni kamkoliv
            </Text>
          )}
          <Text style={styles.count} allowFontScaling={false}>
            {index + 1}/{deck.length}
          </Text>
        </View>
      )}
    </>
  );

  if (spectator) {
    return (
      <View
        style={styles.wrap}
        accessibilityRole="text"
        accessibilityLabel={deck[index]}
        accessibilityLiveRegion="polite"
      >
        {card}
      </View>
    );
  }

  return (
    <Pressable
      onPress={next}
      style={styles.wrap}
      accessibilityRole={single ? "text" : "button"}
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        single ? deck[index] : `${deck[index] ?? ""} Ťukni pro další.`
      }
    >
      {card}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: MockLayout.screenPad,
  },
  intro: {
    fontSize: 15,
    fontWeight: "600",
    color: withAlpha(Colors.foam, 0.5),
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
  card: { justifyContent: "center" },
  prompt: {
    fontSize: 30,
    lineHeight: 40,
    fontWeight: "800",
    color: Colors.foam,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  foot: {
    position: "absolute",
    left: MockLayout.screenPad,
    right: MockLayout.screenPad,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hint: {
    fontSize: 14,
    fontWeight: "600",
    color: withAlpha(Colors.foam, 0.35),
  },
  count: {
    marginLeft: "auto",
    fontFamily: Fonts.numeral,
    fontSize: 15,
    color: withAlpha(Colors.foam, 0.35),
    fontVariant: ["tabular-nums"],
  },
});
