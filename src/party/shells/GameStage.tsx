/**
 * The stage — the one frame every game is played on.
 *
 * Flaška was the only game that read as a game: a big rounded playfield filling
 * the width, one object in the middle of it, the answer in native type directly
 * underneath, one amber pill. Everything else was words on black. This file is
 * that frame, extracted, so all nine games sit in the same box with the same
 * spacing and the phone in the middle of the table always looks like the same
 * app.
 *
 * The pieces, in the order they appear on screen:
 *
 *   StageIntro     small line above the stage ("Kdo se zasekne, ťukne si.")
 *   GameStage      the playfield: rounded surface, vignette, corner chips
 *   StageStatus    avatar disc + one big sentence ("KlaraNaCepu je na řadě")
 *   StageChips     the row of player chips, with a score when a game keeps one
 *   StagePill      exactly one amber primary, or a quiet secondary
 *
 * The vignette is drawn with `react-native-svg` (already a dependency — the
 * covers use it) rather than a gradient package, and it is one radial stop of
 * black at 34 %. It is what makes the surface read as a lit table rather than a
 * flat card; it is not decoration that says anything, so it never gets brighter
 * than that.
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop, Path } from "react-native-svg";

import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { MockLayout, MockType } from "@/mocks/mockTheme";
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { Radius, Spacing } from "@/theme/layout";

/** Fill the stage. `StyleSheet.absoluteFillObject` is absent from our RN types. */
export const STAGE_FILL = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;

/** Screen padding, shared so no shell re-picks its own margin. */
export const STAGE_PAD = MockLayout.screenPad;

/**
 * Room under the stage for the beer pill that floats over every game.
 *
 * It used to be re-added by hand in five shells with three different numbers.
 */
export const STAGE_DOCK_INSET = 88;

/**
 * How tall the playfield is: a little over half the screen.
 *
 * Fixed as a fraction rather than `flex: 1` because the whole point is that the
 * frame does not change shape between games — a card game and a dice game have
 * to look like the same table. It still shrinks (`flexShrink`) when Dynamic Type
 * grows the status line and the chips underneath it.
 */
export function useStageHeight(fraction = 0.54): number {
  const { height } = useWindowDimensions();
  return Math.max(220, Math.min(Math.round(height * fraction), 620));
}

export function GameStage({
  children,
  /** Small chip pinned inside the stage, top left. Deck counters live here. */
  topLeft,
  /** Small chip pinned inside the stage, top right. */
  topRight,
  fraction,
  style,
  ...rest
}: {
  children?: React.ReactNode;
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  fraction?: number;
  style?: StyleProp<ViewStyle>;
} & React.ComponentProps<typeof View>) {
  const height = useStageHeight(fraction);
  return (
    <View style={[styles.stage, { height }, style]} {...rest}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="stageVignette" cx="50%" cy="42%" r="78%">
            <Stop offset="0" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.34" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#stageVignette)" />
      </Svg>
      {children}
      {topLeft ? <View style={styles.cornerLeft}>{topLeft}</View> : null}
      {topRight ? <View style={styles.cornerRight}>{topRight}</View> : null}
    </View>
  );
}

/**
 * The paper card that sits on the stage.
 *
 * Cream, portrait, softly dropped — a prompt deck and a King's Cup card are the
 * same physical object with different things printed on them, so they are the
 * same component. Dark ink on paper is also the one place in this app where
 * text is not foam, and that is deliberate: it is what makes it read as a thing
 * lying on the table rather than a panel in the UI.
 */
export function StageCard({
  children,
  /** Full width and only as tall as its text — a quiz question, not a deck card. */
  wide = false,
  ruled = true,
  style,
  ...rest
}: {
  children?: React.ReactNode;
  wide?: boolean;
  ruled?: boolean;
  style?: StyleProp<ViewStyle>;
} & React.ComponentProps<typeof View>) {
  return (
    <View style={[wide ? styles.paperWide : styles.paper, style]} {...rest}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 300 400" preserveAspectRatio="none" pointerEvents="none" accessible={false}>
        <Path d="M4 5 294 1 299 394 7 399 1 210Z" fill={Colors.foam} />
        {ruled ? <Path d="M18 19 282 16M17 383 283 380" stroke={Colors.stout} strokeWidth={2} /> : null}
      </Svg>
      {children}
    </View>
  );
}

/** Ink on the paper card. Dark, because the card is cream. */
export const StageInk = {
  strong: "#221B12",
  soft: withAlpha("#221B12", 0.62),
  red: "#B03A2E",
} as const;

/** A counter or a round label, small, inside the stage's corner. */
export function StageChip({
  label,
  tone = "quiet",
}: {
  label: string;
  tone?: "quiet" | "amber";
}) {
  return (
    <View style={[styles.chip, tone === "amber" && styles.chipAmber]}>
      <Text
        style={[styles.chipText, tone === "amber" && styles.chipTextAmber]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </View>
  );
}

/** The line above the stage. One short sentence, never a helper text. */
export function StageIntro({ text }: { text: string }) {
  return (
    <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.body}>
      {text}
    </Text>
  );
}

/**
 * The answer, under the stage: a disc and one big sentence.
 *
 * Under and not over, for the reason Flaška already proved — printed on the
 * playfield the name landed across the object it was talking about.
 */
export function StageStatus({
  name,
  tint,
  text,
  sub,
  accessibilityLabel,
  role,
  live = true,
}: {
  /** Omit for a status with nobody in it ("Zamknuto. Chybí Klára"). */
  name?: string | null;
  tint?: string;
  text: string;
  sub?: string | null;
  accessibilityLabel?: string;
  /** "header" for the line that is the screen's question — whose turn it is. */
  role?: "header" | "text";
  live?: boolean;
}) {
  // Nobody in the line means there is nothing to group: the sentence is the
  // whole status, so it raises itself and swallows no neighbouring button.
  if (!name && !sub) {
    return (
      <Text
        style={[styles.status, styles.statusText, styles.statusAlone]}
        numberOfLines={3}
        maxFontSizeMultiplier={FontScaleCap.heading}
        accessibilityRole={role}
        accessibilityLiveRegion={live ? "polite" : "none"}
        accessibilityLabel={accessibilityLabel ?? text}
      >
        {text}
      </Text>
    );
  }
  return (
    <View
      style={styles.status}
      accessible
      accessibilityRole={role}
      accessibilityLiveRegion={live ? "polite" : "none"}
      accessibilityLabel={accessibilityLabel ?? (sub ? `${text} ${sub}` : text)}
    >
      <View style={styles.statusLine}>
        {name ? (
          <PersonAvatar name={name} tint={tint ?? Colors.amber} size={40} />
        ) : null}
        <Text
          style={styles.statusText}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {text}
        </Text>
      </View>
      {sub ? (
        <Text
          style={styles.statusSub}
          maxFontSizeMultiplier={FontScaleCap.body}
          // Already inside the grouped label above; a second node would read
          // the same sentence twice.
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export interface StageChipPlayer {
  id: string;
  name: string;
  tint: string;
  /** Shown after the name when the game keeps a tally. */
  score?: number | string;
  /** Dimmed — out of the game, already safe, still thinking. */
  dimmed?: boolean;
  /** Amber ring: whose turn it is, who just won the round. */
  on?: boolean;
}

/** The row of people, under the status line. Compact — it is context. */
export function StageChips({
  players,
  onPress,
}: {
  players: StageChipPlayer[];
  onPress?: (playerId: string) => void;
}) {
  if (players.length === 0) return null;
  return (
    <View style={styles.chips}>
      {players.map((player) => {
        const inner = (
          <>
            <PersonAvatar name={player.name} tint={player.tint} size={22} />
            <Text
              style={[styles.chipName, player.dimmed && styles.chipNameOut]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {player.name}
            </Text>
            {player.score === undefined ? null : (
              <Text style={styles.chipScore} allowFontScaling={false}>
                {player.score}
              </Text>
            )}
          </>
        );
        const label =
          player.score === undefined
            ? player.name
            : `${player.name} ${player.score}`;
        if (!onPress) {
          return (
            <View
              key={player.id}
              style={[styles.playerChip, player.on && styles.playerChipOn]}
              accessible
              accessibilityRole="text"
              accessibilityLabel={label}
            >
              {inner}
            </View>
          );
        }
        return (
          <Pressable
            key={player.id}
            onPress={() => onPress(player.id)}
            style={({ pressed }) => [
              styles.playerChip,
              player.on && styles.playerChipOn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            {inner}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The one button.
 *
 * `primary` is the single amber pill a game screen is allowed (§2.2); anything
 * else on the screen is `quiet` — a `stout3` pill, never an outline (§6.2).
 */
export function StagePill({
  label,
  onPress,
  disabled = false,
  tone = "primary",
  accessibilityLabel,
  stretch = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "quiet" | "muted";
  accessibilityLabel?: string;
  stretch?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pill,
        stretch ? styles.pillWide : styles.pillTight,
        tone === "quiet" && styles.pillQuiet,
        tone === "muted" && styles.pillMuted,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
    >
      <Text
        style={[styles.pillText, tone === "quiet" && styles.pillTextQuiet]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The body every shell shares: screen padding, room for the beer pill. */
export function stageBody(bottomInset: number): ViewStyle {
  return {
    flex: 1,
    paddingHorizontal: STAGE_PAD,
    paddingBottom: bottomInset + STAGE_DOCK_INSET,
  };
}

const styles = StyleSheet.create({
  stage: {
    alignSelf: "stretch",
    flexShrink: 1,
    minHeight: 200,
    borderRadius: Radius.cardLarge,
    overflow: "hidden",
    backgroundColor: Colors.stout2,
    alignItems: "center",
    justifyContent: "center",
  },
  cornerLeft: {
    position: "absolute",
    left: Spacing.md,
    top: Spacing.md,
    maxWidth: "72%",
  },
  cornerRight: {
    position: "absolute",
    right: Spacing.md,
    top: Spacing.md,
    maxWidth: "72%",
  },

  paper: {
    width: "78%",
    maxWidth: 300,
    // Leaves the top strip of the stage to the corner chips, and keeps the card
    // inside a short stage instead of letting the aspect ratio clip it.
    maxHeight: "84%",
    marginTop: Spacing.xl,
    flexShrink: 1,
    aspectRatio: 0.72,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  paperWide: {
    alignSelf: "stretch",
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    backgroundColor: "transparent",
    justifyContent: "center",
    shadowColor: Colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  chip: {
    minHeight: 26,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
  chipAmber: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  chipText: { ...MockType.label, color: withAlpha(Colors.foam, 0.7) },
  chipTextAmber: { color: Colors.amber },

  intro: {
    ...MockType.label,
    color: Colors.mutedText,
    textAlign: "center",
    marginBottom: Spacing.md,
  },

  status: { marginTop: Spacing.lg, gap: Spacing.xs },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  statusText: {
    flexShrink: 1,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    color: Colors.foam,
    letterSpacing: -0.5,
  },
  statusAlone: { textAlign: "center", fontSize: 22, lineHeight: 28 },
  statusSub: {
    ...MockType.bodySmall,
    color: Colors.mutedText,
    textAlign: "center",
  },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  playerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 34,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  playerChipOn: { backgroundColor: withAlpha(Colors.amber, 0.18) },
  chipName: {
    maxWidth: 140,
    ...MockType.bodySmall,
    fontWeight: "600",
    color: Colors.foam,
  },
  chipNameOut: { color: withAlpha(Colors.foam, 0.4) },
  chipScore: {
    fontFamily: Fonts.numeral,
    fontSize: 15,
    lineHeight: 19,
    includeFontPadding: false,
    color: Colors.foam,
    fontVariant: ["tabular-nums"],
  },

  pill: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  pillWide: { alignSelf: "stretch" },
  pillTight: { alignSelf: "center", paddingHorizontal: 44 },
  pillQuiet: { backgroundColor: Colors.stout3 },
  pillMuted: { backgroundColor: withAlpha(Colors.amber, 0.35) },
  pillText: { ...MockType.buttonLabel, color: Colors.stout },
  pillTextQuiet: { color: Colors.foam },

  pressed: { opacity: 0.8 },
});
