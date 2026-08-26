/**
 * A deck of prompts, one card at a time.
 *
 * Four of the games are this — "Kategorie", "Nikdy jsem…", "Palec", "Pravidlo
 * večera" — and they differ only in what is printed on the cards.
 *
 * The prompt used to be bare text floating on a black screen, which read as an
 * error message rather than a game. It is now a physical card lying on the
 * stage: cream paper, dark ink, the game's glyph at the top and the deck
 * counter in the corner. A phone in the middle of a pub table is read by five
 * people at arm's length in bad light, so the prompt is still the biggest thing
 * on the screen — it just now looks like an object you dealt.
 *
 * You tap the card to deal the next one, which is the one gesture that survives
 * being drunk; the amber pill does the same thing for anyone who reads buttons.
 *
 * The deck is SHUFFLED once and then dealt through, rather than picking at
 * random each time. Random repeats, and a repeat two cards apart is the moment
 * a table decides the app is broken. When it runs out it reshuffles and says so.
 */

import React, { type ComponentType } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutLeft,
  useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  GameStage,
  STAGE_FILL,
  StageCard,
  StageChip,
  StageInk,
  StageIntro,
  StagePill,
  stageBody,
} from "@/party/shells/GameStage";
import { FontScaleCap } from "@/theme/fonts";
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

/** The deal: the old card leaves left, the new one arrives from the right. */
const DEAL_MS = 250;

export function PromptShell({
  prompts,
  intro,
  seed,
  step,
  onNext,
  Icon,
  spectator = false,
}: {
  prompts: readonly string[];
  intro?: string;
  /** Varies the order between games without calling `Math.random()` in render. */
  seed: number;
  /** Shared append-only position. Omit for a local-only game. */
  step?: number;
  onNext?: () => void;
  /** The game's glyph, small, at the top of the card. */
  Icon?: ComponentType<{ size?: number; color: string }>;
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

  const stage = (
    <GameStage
      topRight={
        single ? undefined : (
          <StageChip label={`${index + 1}/${deck.length}`} />
        )
      }
    >
      <Animated.View
        // Keyed by the card, so React unmounts one and mounts the next — which
        // is what makes this a deal rather than text swapping inside a box.
        key={`${index}-${deck[index]}`}
        entering={
          reduceMotion
            ? undefined
            : single
              ? FadeIn.duration(DEAL_MS)
              : SlideInRight.duration(DEAL_MS)
        }
        exiting={
          reduceMotion
            ? undefined
            : single
              ? FadeOut.duration(140)
              : SlideOutLeft.duration(DEAL_MS)
        }
        style={styles.dealt}
        pointerEvents="none"
      >
        <StageCard>
          {Icon ? (
            <View style={styles.glyph}>
              <Icon size={20} color={StageInk.soft} />
            </View>
          ) : null}
          <Text
            style={styles.prompt}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {deck[index]}
          </Text>
        </StageCard>
      </Animated.View>
    </GameStage>
  );

  return (
    <View style={stageBody(insets.bottom)}>
      {intro ? <StageIntro text={intro} /> : null}

      {spectator || single ? (
        <View
          style={styles.stageWrap}
          accessibilityRole="text"
          accessibilityLabel={deck[index]}
          accessibilityLiveRegion="polite"
        >
          {stage}
        </View>
      ) : (
        <Pressable
          onPress={next}
          style={styles.stageWrap}
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${deck[index] ?? ""} Ťukni pro další.`}
        >
          {stage}
        </Pressable>
      )}

      {single || spectator ? null : (
        <View style={styles.dock}>
          <StagePill label="Další" onPress={next} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stageWrap: { flexShrink: 1 },
  dealt: {
    ...STAGE_FILL,
    alignItems: "center",
    justifyContent: "center",
  },
  glyph: { position: "absolute", top: Spacing.md },
  prompt: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "800",
    color: StageInk.strong,
    textAlign: "center",
    letterSpacing: -0.4,
  },
  dock: { marginTop: "auto", paddingTop: Spacing.lg },
});
