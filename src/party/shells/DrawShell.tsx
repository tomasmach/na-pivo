/**
 * Chance, drawn: a card off the top, or a person out of the hat.
 *
 * King's Cup is the game this is really for, and what makes it worth opening a
 * phone for is not the answer — anyone could deal a real deck — it is the
 * SUSPENSE before it. So nothing here just prints a result: the card turns over.
 *
 * The card is now a card. Rank and suit in both corners, red on cream for the
 * hearts and diamonds, the rule's title in the middle and the rule under it;
 * before the first draw the deck shows its back — stout, with the repeated
 * glyph pattern drawn out of plain Views, because a "?" in a grey box is not a
 * playing card and the whole table could see that.
 *
 * The draw lands on a value chosen up front and then animates TO it, rather
 * than animating and reading off whatever it hits. Otherwise reduced motion —
 * where there is no animation to read off — would need its own second
 * implementation, and the two would drift.
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
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { kingsDeck, KINGS_CARDS, KINGS_DECK } from "@/party/gameContent";
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
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { Radius, Spacing } from "@/theme/layout";

/** Kostky has its own turn-based table now, so nothing draws dice here. */
export type DrawKind = "person" | "card";

/** Long enough to be a moment, short enough that nobody puts the phone down. */
const ROLL_MS = 900;

/** Bounds an optimistic lock whose canonical result never arrives. */
const LOCK_RECOVERY_MS = 1200;

/** Module scope so `react-hooks/purity` can see these are taps, not render. */
const pick = <T,>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)];

const SUIT_GLYPH: Record<string, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

/** Hearts and diamonds are red. On a cream card that is not decoration. */
function suitInk(suit?: string): string {
  return suit === "hearts" || suit === "diamonds"
    ? StageInk.red
    : StageInk.strong;
}

export interface DrawPlayer {
  id: string;
  name: string;
  tint?: string;
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
  drawnCardIds,
  onDeckFinished,
  seed = 1,
  spectator = false,
}: {
  kind: DrawKind;
  players: DrawPlayer[];
  intro?: string;
  action: string;
  /** Latest folded shared result. Omit for local-only state. */
  result?: DrawResult | null;
  onDraw?: (result: DrawResult) => void;
  /** Canonical physical cards already drawn, in cursor order. */
  drawnCardIds?: readonly string[];
  onDeckFinished?: (result: DrawResult) => void;
  seed?: number;
  /** Read-only view: the last card stays up, but nobody draws from here. */
  spectator?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [localResult, setLocalResult] = React.useState<DrawResult | null>(null);
  const [localCardIds, setLocalCardIds] = React.useState<string[]>([]);
  const [rolling, setRolling] = React.useState(false);
  const interactionLocked = React.useRef(false);
  const fallbackUnlock = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  /**
   * The draw resolves on the phone that drew it, full stop.
   *
   * In shared mode the card used to be read ONLY from the folded server/queue
   * state, so the moment that fold came back empty — a rejected enqueue, a
   * rolled-back optimistic action, a table where the other phone never answers
   * — the card flipped back to its back and the drawer was left staring at it.
   * The canonical shared draw still wins the moment it exists; until then this
   * phone shows its own.
   */
  const shown = result ?? localResult;
  const effectiveCardIds = React.useMemo(
    () =>
      drawnCardIds === undefined
        ? localCardIds
        : [...drawnCardIds, ...localCardIds.filter((id) => !drawnCardIds.includes(id))],
    [drawnCardIds, localCardIds],
  );
  const deckFinished =
    kind === "card" &&
    effectiveCardIds.filter((cardId) => cardId.endsWith("-K") || cardId === "K")
      .length >= 4;
  const shownPlayer = players.find((player) => player.id === shown?.personId);
  const shownCard =
    KINGS_DECK.find((card) => card.id === shown?.cardId) ??
    KINGS_CARDS.find((card) => card.card === shown?.cardId);
  const shownRank = shownCard
    ? "card" in shownCard
      ? shownCard.card
      : shownCard.rank
    : null;
  const shownSuit =
    shownCard && "suit" in shownCard ? (shownCard.suit as string) : undefined;
  const remaining = KINGS_DECK.length - effectiveCardIds.length;
  // One announcement per settled draw: the visible rank, title and rule.
  const cardLabel = shownCard
    ? `${shownRank} ${shownCard.title} ${shownCard.rule}`
    : undefined;
  // Seeded with the result already on screen, so a remount never re-announces.
  const announcedNonce = React.useRef(shown?.nonce);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    // Rolling names are decoration over an unsettled draw; wait for rest.
    if (rolling) return;
    const nonce = shown?.nonce;
    if (!nonce || announcedNonce.current === nonce) return;
    const label = shownPlayer?.name ?? cardLabel;
    if (!label) return;
    announcedNonce.current = nonce;
    AccessibilityInfo.announceForAccessibility?.(label);
  }, [rolling, shown?.nonce, shownPlayer?.name, cardLabel]);
  // Unlocks on the CANONICAL draw, not on the optimistic one this phone just
  // painted: otherwise a double tap in reduced motion draws two cards.
  const canonicalNonce = result === undefined ? localResult?.nonce : result?.nonce;
  React.useEffect(() => {
    interactionLocked.current = false;
    if (fallbackUnlock.current) {
      clearTimeout(fallbackUnlock.current);
      fallbackUnlock.current = null;
    }
  }, [canonicalNonce]);
  React.useEffect(
    () => () => {
      if (fallbackUnlock.current) clearTimeout(fallbackUnlock.current);
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const later = (callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay);
    timers.current.push(timer);
  };

  const spin = useSharedValue(0);
  const settle = useSharedValue(1);

  const draw = () => {
    if (spectator || rolling || deckFinished || interactionLocked.current)
      return;
    interactionLocked.current = true;
    // Chosen first, animated to second. The animation is decoration over an
    // answer that already exists, which is what keeps reduced motion honest.
    const next: DrawResult = { nonce: String(Date.now()) };
    if (kind === "person") next.personId = pick(players)?.id;
    else {
      const drawn = new Set(effectiveCardIds);
      const available = kingsDeck(seed).filter((card) => !drawn.has(card.id));
      next.cardId = available[0]?.id;
      if (!next.cardId) {
        interactionLocked.current = false;
        return;
      }
    }

    const publish = () => {
      setLocalResult(next);
      if (next.cardId) {
        setLocalCardIds((current) =>
          current.includes(next.cardId!) ? current : [...current, next.cardId!],
        );
      }
      onDraw?.(next);
      const finishesDeck =
        next.cardId?.endsWith("-K") &&
        effectiveCardIds.filter((cardId) => cardId.endsWith("-K")).length === 3;
      if (finishesDeck && onDeckFinished && !spectator) {
        // Persist first, show the fourth king second, leave the screen last.
        // Without this beat GameResult replaces the card in the same render and
        // the moment the whole game builds toward is never actually visible.
        later(() => onDeckFinished(next), reduceMotion ? 700 : ROLL_MS + 700);
      }
    };

    if (reduceMotion) {
      publish();
      // No animation to finish, so nothing else unlocks: bound the lock in
      // case the canonical result never lands.
      if (fallbackUnlock.current) clearTimeout(fallbackUnlock.current);
      fallbackUnlock.current = setTimeout(() => {
        interactionLocked.current = false;
      }, LOCK_RECOVERY_MS);
      return;
    }

    setRolling(true);
    spin.value = 0;
    settle.value = 0.8;
    spin.value = withTiming(1, {
      duration: ROLL_MS,
      easing: Easing.out(Easing.cubic),
    });
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
    later(() => {
      setRolling(false);
      interactionLocked.current = false;
    }, ROLL_MS);
  };

  /**
   * Two half turns over the roll: the back goes round twice and the face is
   * already at rest when it swaps in, so it reads as one card turning over
   * rather than two cards trading places.
   */
  const flipStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { rotateY: `${spin.value * 360}deg` },
      { scale: settle.value },
    ],
  }));

  const label = rolling
    ? "…"
    : deckFinished
      ? "Dohráno"
      : shown
        ? "Znovu"
        : action;

  return (
    <View style={stageBody(insets.bottom)}>
      {intro && !shown ? <StageIntro text={intro} /> : null}

      <GameStage
        topRight={
          kind === "card" ? (
            <StageChip label={`Zbývá ${Math.max(0, remaining)}`} />
          ) : undefined
        }
      >
        {kind === "person" ? (
          <Animated.View style={flipStyle}>
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
                accessibilityLabel={shownPlayer?.name}
                accessibilityLiveRegion="polite"
              >
                {shownPlayer?.name ?? "…"}
              </Text>
            )}
          </Animated.View>
        ) : null}

        {kind === "card" ? (
          <Animated.View style={[styles.cardWrap, flipStyle]}>
            {rolling || !shownCard ? (
              <CardBack />
            ) : (
              <StageCard>
                <CardCorner rank={shownRank} suit={shownSuit} place="top" />
                <Animated.View
                  key={shown?.nonce}
                  entering={reduceMotion ? undefined : FadeIn.duration(200)}
                  style={styles.face}
                  accessible
                  accessibilityRole="text"
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={cardLabel}
                >
                  <Text
                    style={styles.cardTitle}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {shownCard.title}
                  </Text>
                  <Text
                    style={styles.cardRule}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {shownCard.rule}
                  </Text>
                </Animated.View>
                <CardCorner rank={shownRank} suit={shownSuit} place="bottom" />
              </StageCard>
            )}
          </Animated.View>
        ) : null}
      </GameStage>

      <View style={styles.dock}>
        <StagePill
          label={label}
          onPress={draw}
          disabled={spectator || rolling || deckFinished}
          tone={spectator ? "muted" : "primary"}
          accessibilityLabel={
            deckFinished ? "Dohráno" : shown ? `${action} znovu` : action
          }
        />
      </View>
    </View>
  );
}

/** Rank and suit in the card's corner — upright at the top, upside down below. */
function CardCorner({
  rank,
  suit,
  place,
}: {
  rank: string | null;
  suit?: string;
  place: "top" | "bottom";
}) {
  const ink = suitInk(suit);
  return (
    <View
      style={[
        styles.corner,
        place === "top" ? styles.cornerTop : styles.cornerBottom,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.rank, { color: ink }]} allowFontScaling={false}>
        {rank}
      </Text>
      {suit ? (
        <Text style={[styles.suit, { color: ink }]} allowFontScaling={false}>
          {SUIT_GLYPH[suit]}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The deck, face down.
 *
 * A repeating diamond lattice built out of plain Views — no image, no SVG, and
 * nothing that has to be commissioned. It only has to say "there is a deck here
 * and you have not turned it over yet", and at arm's length across a table it
 * does.
 */
function CardBack() {
  return (
    <View
      testID="card-back"
      style={styles.back}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.backPattern} pointerEvents="none">
        {Array.from({ length: 7 }).map((_, row) => (
          <View key={row} style={styles.backRow}>
            {Array.from({ length: 5 }).map((__, column) => (
              <View key={column} style={styles.backPip} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/** The names cycling while a random-person draw is still running. */
function RollingNames({ players }: { players: DrawPlayer[] }) {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => setIndex((current) => current + 1), 80);
    return () => clearInterval(id);
  }, []);

  return (
    <Text
      style={[styles.person, styles.personRolling]}
      numberOfLines={1}
      allowFontScaling={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {players[index % players.length]?.name ?? "…"}
    </Text>
  );
}

const styles = StyleSheet.create({
  person: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: "800",
    color: Colors.foam,
    textAlign: "center",
    letterSpacing: -0.6,
  },
  personRolling: { color: withAlpha(Colors.foam, 0.45) },

  cardWrap: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  face: { alignItems: "center", justifyContent: "center", width: "100%" },
  corner: { position: "absolute", alignItems: "center" },
  cornerTop: { top: Spacing.md, left: Spacing.md },
  cornerBottom: {
    bottom: Spacing.md,
    right: Spacing.md,
    transform: [{ rotate: "180deg" }],
  },
  rank: {
    fontFamily: Fonts.numeral,
    fontSize: 22,
    lineHeight: 27,
    includeFontPadding: false,
  },
  suit: { fontSize: 16, lineHeight: 18, fontWeight: "700" },
  cardTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    color: StageInk.strong,
    textAlign: "center",
    letterSpacing: -0.5,
  },
  cardRule: {
    marginTop: Spacing.sm,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
    color: StageInk.soft,
    textAlign: "center",
  },

  back: {
    width: "78%",
    maxWidth: 300,
    maxHeight: "84%",
    marginTop: Spacing.xl,
    aspectRatio: 0.72,
    borderRadius: Radius.medium,
    overflow: "hidden",
    backgroundColor: Colors.stout3,
    borderWidth: 6,
    borderColor: Colors.foam,
    alignItems: "center",
    justifyContent: "center",
  },
  backPattern: { ...STAGE_FILL, justifyContent: "space-evenly" as const },
  backRow: { flexDirection: "row", justifyContent: "space-evenly" },
  backPip: {
    width: 14,
    height: 14,
    borderRadius: 3,
    transform: [{ rotate: "45deg" }],
    backgroundColor: withAlpha(Colors.amber, 0.16),
  },

  dock: { marginTop: "auto", paddingTop: Spacing.lg },
});
