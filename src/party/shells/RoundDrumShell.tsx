/**
 * Kdo platí rundu — a real drum, on the stage.
 *
 * Names scroll through a window with an amber frame and fade out into the
 * table above and below it, and whatever is in the window when the drum stops
 * is who is buying. It used to be a plain column of names on black, which read
 * as a list rather than as something spinning; the frame and the fade are what
 * make it a drum.
 *
 * The drum ENDS on the first stop, because a round has exactly one payer. The
 * sentence saying who that is stays in React Native, under the stage, where it
 * has the app's type and a voice (§21.4.3).
 */

import React from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { t } from "@/i18n";
import { displayPersonName } from "@/party/nightBuilder";
import {
  GameStage,
  StagePill,
  StageStatus,
  stageBody,
} from "@/party/shells/GameStage";
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap } from "@/theme/fonts";
import { Radius, Spacing } from "@/theme/layout";
import type { PickPlayer } from "@/party/shells/PickShell";

const SPIN_MS = 2200;
const SLOT_HEIGHT = 78;

const pickOne = (players: readonly PickPlayer[]): string =>
  players[Math.floor(Math.random() * players.length)]?.id ?? "";

function displayName(player: PickPlayer | undefined, index: number): string {
  const name = player?.name.trim();
  return name ? displayPersonName(name) : t.gameShell.playerNumber(index + 1);
}

export function RoundDrumShell({
  players,
  pickedId,
  onPicked,
  spectator = false,
  onDone,
  bottomInset = 0,
}: {
  players: PickPlayer[];
  pickedId: string | null;
  onPicked?: (playerId: string) => void | Promise<unknown>;
  /** Watch-only view: a canonical pick keeps its way back, nobody spins from here. */
  spectator?: boolean;
  onDone?: () => void;
  bottomInset?: number;
}) {
  const reduceMotion = useReducedMotion();
  const [localPickedId, setLocalPickedId] = React.useState<string | null>(
    pickedId,
  );
  const [cursor, setCursor] = React.useState(0);
  const [spinning, setSpinning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  // Bumped on every local publish, so a repeat pick of the same player is
  // still a fresh result worth announcing.
  const [localResultRevision, setLocalResultRevision] = React.useState(0);
  const locked = React.useRef(false);
  const mounted = React.useRef(true);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const effectiveId = pickedId ?? localPickedId;

  React.useEffect(() => {
    locked.current = false;
  }, [pickedId]);
  React.useEffect(
    () => {
      mounted.current = true;
      const activeTimers = timers.current;
      return () => {
        mounted.current = false;
        activeTimers.forEach(clearTimeout);
      };
    },
    [],
  );

  const selectedIndex = Math.max(
    0,
    players.findIndex((player) => player.id === effectiveId),
  );
  const centerIndex = spinning
    ? cursor % Math.max(1, players.length)
    : selectedIndex;
  const slots = Array.from({ length: 5 }, (_, slot) => {
    const offset = slot - 2;
    const count = Math.max(1, players.length);
    const index = (((centerIndex + offset) % count) + count) % count;
    return { player: players[index], index, offset };
  });
  const selected = players.find((player) => player.id === effectiveId);
  const selectedName = displayName(selected, selectedIndex);
  const settled = Boolean(effectiveId) && !spinning;
  const drumLabel = settled
    ? t.gameResult.payingOther(selectedName)
    : t.gameShell.drumA11y;
  // Keyed by the stable id plus publish revision, not the label: two players
  // may share a name, and the canonical pick arriving for an already-published
  // local result keeps this key unchanged (no duplicate announcement).
  const resultKey =
    settled && effectiveId ? `${effectiveId}#${localResultRevision}` : null;
  const announcedResult = React.useRef<string | null>(resultKey);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!settled) {
      // While the drum moves there is no result; the next one to settle is
      // worth saying even if it lands on the same player again.
      announcedResult.current = null;
      return;
    }
    if (!resultKey || announcedResult.current === resultKey) return;
    announcedResult.current = resultKey;
    AccessibilityInfo.announceForAccessibility?.(drumLabel);
  }, [settled, resultKey, drumLabel]);

  const publish = (playerId: string) => {
    if (spectator) return;
    setLocalPickedId(playerId);
    setLocalResultRevision((value) => value + 1);
    setSpinning(false);
    const completion = onPicked?.(playerId);
    if (completion) {
      setSaving(true);
      const release = () => {
        locked.current = false;
        if (mounted.current) setSaving(false);
      };
      void completion.then(release, release);
      return;
    }
    const unlockTimer = setTimeout(
      () => {
        locked.current = false;
      },
      reduceMotion ? 350 : 0,
    );
    timers.current.push(unlockTimer);
  };

  const spin = () => {
    if (spectator) {
      // Navigation is not gameplay: with a canonical pick the spectator keeps
      // its way back to the evening, without one there is nothing to leave for.
      if (effectiveId) onDone?.();
      return;
    }
    if (locked.current || players.length === 0) return;
    locked.current = true;
    const playerId = pickOne(players);
    if (reduceMotion) {
      publish(playerId);
      return;
    }
    setSpinning(true);
    setLocalPickedId(null);
    const startedAt = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SPIN_MS) {
        publish(playerId);
        return;
      }
      setCursor((value) => value + 1);
      const progress = elapsed / SPIN_MS;
      const delay = 45 + progress * progress * 210;
      const timer = setTimeout(tick, delay);
      timers.current.push(timer);
    };
    tick();
  };

  const label = spinning
    ? "…"
    : spectator && effectiveId
      ? t.gameShell.backToNight
      : effectiveId
        ? t.gameShell.spinAgain
        : t.gameShell.spin;

  return (
    <View style={stageBody(bottomInset)}>
      <GameStage>
        <View
          style={styles.drum}
          accessible
          accessibilityRole="text"
          // Only a settled result may raise itself; the decorative spinning
          // drum stays silent for VoiceOver-style live regions (Android).
          accessibilityLiveRegion={settled ? "polite" : "none"}
          accessibilityLabel={drumLabel}
        >
          {slots.map(({ player, index, offset }, slot) => (
            <View
              key={`${slot}-${player?.id ?? index}`}
              style={styles.slot}
              importantForAccessibility="no-hide-descendants"
            >
              <Text
                style={[
                  styles.slotText,
                  Math.abs(offset) === 1 && styles.slotNear,
                  Math.abs(offset) === 2 && styles.slotFar,
                  offset === 0 && settled && styles.slotTextOn,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.74}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {displayName(player, index)}
              </Text>
            </View>
          ))}
        </View>

        {/* The window. An amber frame around the one slot that counts, and the
            drum fading out into the stage above and below it — that is what
            makes names GO PAST rather than a list sitting there. */}
        <View pointerEvents="none" style={styles.window} />
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <LinearGradient id="drumFadeTop" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={Colors.stout2} stopOpacity="1" />
              <Stop offset="1" stopColor={Colors.stout2} stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id="drumFadeBottom" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={Colors.stout2} stopOpacity="0" />
              <Stop offset="1" stopColor={Colors.stout2} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="26%" fill="url(#drumFadeTop)" />
          <Rect x="0" y="74%" width="100%" height="26%" fill="url(#drumFadeBottom)" />
        </Svg>
      </GameStage>

      {settled && selected ? (
        <StageStatus
          name={selectedName}
          tint={selected.tint}
          text={t.gameResult.payingOther(selectedName)}
          sub={t.gameShell.roundForTable}
        />
      ) : null}

      <View style={styles.dock}>
        <StagePill
          label={label}
          onPress={spin}
          disabled={spinning || saving || Boolean(spectator && !effectiveId)}
          tone={
            (spectator && !effectiveId) || saving
              ? "muted"
              : effectiveId
                ? "quiet"
                : "primary"
          }
          accessibilityLabel={
            spectator && effectiveId
              ? t.gameShell.backToNight
              : effectiveId
                ? t.gameShell.spinAgain
                : t.gameShell.spin
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  drum: { height: SLOT_HEIGHT * 5, alignSelf: "stretch" },
  slot: {
    height: SLOT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  slotText: {
    fontSize: 27,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: Colors.foam,
  },
  slotNear: { opacity: 0.5 },
  slotFar: { opacity: 0.26 },
  slotTextOn: { fontSize: 30, fontWeight: "800", color: Colors.amber },
  window: {
    position: "absolute",
    left: Spacing.md,
    right: Spacing.md,
    height: SLOT_HEIGHT,
    borderRadius: Radius.medium,
    borderWidth: 2,
    borderColor: withAlpha(Colors.amber, 0.85),
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  dock: { marginTop: "auto", paddingTop: Spacing.lg },
});
