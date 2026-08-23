import React from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { MockColors, MockLayout, MockType } from "@/mocks/mockTheme";
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
  return name || `Hráč ${index + 1}`;
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
  onPicked?: (playerId: string) => void;
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
  // Bumped on every local publish, so a repeat pick of the same player is
  // still a fresh result worth announcing.
  const [localResultRevision, setLocalResultRevision] = React.useState(0);
  const locked = React.useRef(false);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const effectiveId = pickedId ?? localPickedId;

  React.useEffect(() => {
    locked.current = false;
  }, [pickedId]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);

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
  const drumLabel = settled ? `Platí ${selectedName}` : "Buben se jmény hráčů";
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
    onPicked?.(playerId);
    const unlock = setTimeout(
      () => {
        locked.current = false;
      },
      reduceMotion ? 350 : 0,
    );
    timers.current.push(unlock);
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

  return (
    <View style={[styles.body, { paddingBottom: bottomInset + Spacing.sm }]}>
      <View style={styles.drumWrap}>
        <View
          style={styles.drum}
          accessible
          accessibilityRole="text"
          // Only a settled result may raise itself; the decorative spinning
          // drum stays silent for VoiceOver-style live regions (Android).
          accessibilityLiveRegion={settled ? "polite" : "none"}
          accessibilityLabel={drumLabel}
        >
          {slots.map(({ player, index, offset }, slot) => {
            const on = offset === 0 && Boolean(effectiveId) && !spinning;
            return (
              <View
                key={`${slot}-${player?.id ?? index}`}
                style={[styles.slot, on && styles.slotOn]}
                importantForAccessibility="no-hide-descendants"
              >
                <Text
                  style={[
                    styles.slotText,
                    Math.abs(offset) === 1 && styles.slotNear,
                    Math.abs(offset) === 2 && styles.slotFar,
                    on && styles.slotTextOn,
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.74}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {displayName(player, index)}
                </Text>
              </View>
            );
          })}
          {!effectiveId || spinning ? (
            <View pointerEvents="none" style={styles.gate} />
          ) : null}
        </View>
        <Text style={styles.note} maxFontSizeMultiplier={FontScaleCap.body}>
          {effectiveId && !spinning ? "Platí. Runda pro stůl." : " "}
        </Text>
      </View>

      <View style={styles.dock}>
        <Pressable
          onPress={spin}
          disabled={spinning || Boolean(spectator && !effectiveId)}
          style={({ pressed }) => [
            styles.action,
            effectiveId && styles.actionQuiet,
            spectator && !effectiveId && styles.actionMuted,
            (pressed || spinning) && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            spectator && effectiveId
              ? "Zpátky k večeru"
              : effectiveId
                ? "Roztoč znovu"
                : "Roztoč"
          }
          accessibilityState={{
            disabled: spinning || Boolean(spectator && !effectiveId),
          }}
        >
          <Text
            style={[styles.actionText, effectiveId && styles.actionTextQuiet]}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {spinning
              ? "…"
              : spectator && effectiveId
                ? "Zpátky k večeru"
                : effectiveId
                  ? "Roztoč znovu"
                  : "Roztoč"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: MockLayout.screenPad },
  drumWrap: { flex: 1, justifyContent: "center" },
  drum: { height: 392, overflow: "hidden" },
  slot: {
    height: SLOT_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  slotOn: { backgroundColor: Colors.amber },
  slotText: {
    fontSize: 27,
    fontWeight: "700",
    letterSpacing: -0.5,
    color: Colors.foam,
  },
  slotNear: { opacity: 0.52 },
  slotFar: { opacity: 0.3 },
  slotTextOn: {
    color: Colors.stout,
    opacity: 1,
    fontSize: 30,
    fontWeight: "800",
  },
  gate: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 157,
    height: SLOT_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  note: {
    height: 44,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "500",
    color: Colors.mutedText,
  },
  dock: { paddingTop: 14 },
  action: {
    flex: 1,
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  actionQuiet: { backgroundColor: MockColors.surfaceHigh },
  actionMuted: { backgroundColor: withAlpha(Colors.amber, 0.35) },
  actionText: { ...MockType.buttonLabel, color: Colors.stout },
  actionTextQuiet: { color: Colors.foam },
  pressed: { opacity: 0.72 },
});
