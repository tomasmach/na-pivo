/**
 * A game whose whole job is to point at somebody — Flaška, Kdo platí rundu.
 *
 * The canvas spins the object and reports an id; every word on the screen is
 * drawn here, in React Native. That split is the rule for all of these (§18.11a)
 * and it is what keeps a name in the app's own type, at the app's own size, with
 * VoiceOver able to read it.
 *
 * The shell is deliberately thin: it knows a player id, a verb and whether the
 * game ends. Adding "Kdo jde pro další" later is a catalogue row, not a file.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PersonAvatar } from "@/components/shared/PersonAvatar";
import {
  GAME_HOST_AVAILABLE,
  GameHost,
  type GameHostHandle,
} from "@/games/GameHost";
import { GameResult, type GameOutcome } from "@/games/GameResult";
import { MockLayout, MockType } from "@/mocks/mockTheme";
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap } from "@/theme/fonts";
import { Radius, Spacing } from "@/theme/layout";

export interface PickPlayer {
  id: string;
  name: string;
  tint: string;
}

/** Module scope so `react-hooks/purity` can see this is a tap, not render. */
const pickOne = (players: PickPlayer[]): string =>
  players[Math.floor(Math.random() * players.length)]?.id ?? "";

/** Bounds an optimistic lock whose canonical pick never arrives. */
const LOCK_RECOVERY_MS = 1200;

export function PickShell({
  game,
  players,
  action,
  /** What to say once somebody has been chosen. */
  verdict,
  onFinished,
  onDone,
  pickedId,
  pickRevision = 0,
  onPicked,
  spectator = false,
}: {
  /** Which page to host: `bottle`, `wheel`. */
  game: string;
  players: PickPlayer[];
  action: string;
  verdict: (name: string) => string;
  /** Only for games that end on the first pick. */
  onFinished?: (payingName: string, payingId: string) => void;
  /** Leaving a finished game. Absent for games that never end, like Flaška. */
  onDone?: () => void;
  /** Latest folded shared pick. Omit for local-only state. */
  pickedId?: string | null;
  /** Increments for every canonical pick, including the same person twice. */
  pickRevision?: number;
  onPicked?: (playerId: string) => void;
  /** Read-only view: the last verdict stays up, but nobody spins from here. */
  spectator?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const host = React.useRef<GameHostHandle>(null);
  const [localPickedId, setLocalPickedId] = React.useState<string | null>(null);
  const [localPickRevision, setLocalPickRevision] = React.useState(0);
  const [spinning, setSpinning] = React.useState(false);
  const interactionLocked = React.useRef(false);
  /**
   * True from a spin until its messages are accounted for. `spinning` state is
   * stale for messages that land in the same tick, and `interactionLocked` is
   * deliberately released by the valid `picked` event before the wheel's
   * result arrives — so this ref is the only honest "a spin is in flight".
   */
  const spinPending = React.useRef(false);
  const fallbackUnlock = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Set only by games that end — Flaška never does. */
  const [outcome, setOutcome] = React.useState<GameOutcome | null>(null);

  const canvas = GAME_HOST_AVAILABLE && !reduceMotion;
  const controlled = pickedId !== undefined;
  // A previous verdict is not the answer to a new spin. Hide it while the
  // object moves, then key the result by revision so the same person picked
  // twice still re-enters and is announced again.
  const effectivePickedId = spinning
    ? null
    : controlled
      ? pickedId
      : localPickedId;
  const effectiveRevision = controlled ? pickRevision : localPickRevision;
  const pickedPlayer =
    players.find((player) => player.id === effectivePickedId) ?? null;
  React.useEffect(() => {
    interactionLocked.current = false;
    if (fallbackUnlock.current) {
      clearTimeout(fallbackUnlock.current);
      fallbackUnlock.current = null;
    }
  }, [effectivePickedId, effectiveRevision]);
  React.useEffect(
    () => () => {
      if (fallbackUnlock.current) clearTimeout(fallbackUnlock.current);
      spinPending.current = false;
    },
    [],
  );

  const recordPick = (playerId: string) => {
    if (spectator) return;
    if (!controlled) {
      setLocalPickedId(playerId);
      setLocalPickRevision((current) => current + 1);
    }
    onPicked?.(playerId);
  };

  const spin = () => {
    if (spectator || spinning || interactionLocked.current) return;
    interactionLocked.current = true;
    if (!canvas) {
      // No object to watch, so no spin to wait for. Same answer, no theatre.
      const playerId = pickOne(players);
      const player = players.find((candidate) => candidate.id === playerId);
      if (!player) {
        // Nothing to point at (empty roster): no pick to record, and the lock
        // must not survive a spin that never happened.
        interactionLocked.current = false;
        return;
      }
      recordPick(playerId);
      onFinished?.(player.name, player.id);
      if (onDone)
        setOutcome({ scores: [], winnerId: null, payingId: player.id });
      // Controlled mode waits for canonical props; bound the lock in case
      // they never advance.
      if (fallbackUnlock.current) clearTimeout(fallbackUnlock.current);
      fallbackUnlock.current = setTimeout(() => {
        interactionLocked.current = false;
      }, LOCK_RECOVERY_MS);
      return;
    }
    setSpinning(true);
    spinPending.current = true;
    if (!controlled) setLocalPickedId(null);
    host.current?.command("spin");
  };

  // A game that ended hands over to the platform's ending, the same one the
  // dice land on.
  const foldedOutcome =
    controlled && pickedPlayer && onDone
      ? { scores: [], winnerId: null, payingId: pickedPlayer.id }
      : null;
  if ((outcome || foldedOutcome) && onDone) {
    return (
      <GameResult
        players={players}
        outcome={outcome ?? foldedOutcome!}
        onDone={onDone}
      />
    );
  }

  return (
    <View style={[styles.body, { paddingBottom: insets.bottom + Spacing.sm }]}>
      <View style={styles.stage}>
        {canvas ? (
          <GameHost
            ref={host}
            game={game}
            // The label is painted on the wheel; the sentence under it is still
            // React Native. See the note on `GamePlayer.label`.
            players={players.map((player) => ({
              id: player.id,
              colour: player.tint,
              label: player.name,
            }))}
            onEvent={(name, payload) => {
              if (spectator || name !== "picked") return;
              // A picked message belongs to a spin; stray messages before the
              // user spun do nothing.
              if (!spinPending.current) return;
              const playerId = (payload as { playerId?: unknown } | undefined)
                ?.playerId;
              if (
                typeof playerId !== "string" ||
                !players.some((player) => player.id === playerId)
              ) {
                spinPending.current = false;
                interactionLocked.current = false;
                setSpinning(false);
                return;
              }
              // Ending games keep the session pending through picked, until a
              // valid result consumes it. Repeatable games (Flaška) are done
              // at picked — nothing further is coming.
              if (!onDone) spinPending.current = false;
              interactionLocked.current = false;
              setSpinning(false);
              recordPick(playerId);
            }}
            onResult={(result) => {
              if (spectator) return;
              if (!spinPending.current) return;
              const payer = players.find(
                (player) => player.id === result.payingId,
              );
              spinPending.current = false;
              interactionLocked.current = false;
              setSpinning(false);
              // Only a payer on the roster may end the game — never a neutral
              // "nobody" outcome from an unknown or missing id.
              if (!payer) return;
              setOutcome({ ...result, payingId: payer.id });
              onFinished?.(payer.name, payer.id);
            }}
            onError={() => {
              spinPending.current = false;
              interactionLocked.current = false;
              setSpinning(false);
            }}
          />
        ) : null}

        {/* The name, over the object. Real text, so it scales and speaks. */}
        {pickedPlayer ? (
          <Animated.View
            key={`${pickedPlayer.id}:${effectiveRevision}`}
            entering={FadeIn.duration(220)}
            style={styles.verdict}
            pointerEvents="none"
            accessible
            accessibilityLiveRegion="polite"
            accessibilityLabel={verdict(pickedPlayer.name)}
          >
            <PersonAvatar
              name={pickedPlayer.name}
              tint={pickedPlayer.tint}
              size={44}
            />
            <Text
              style={styles.verdictText}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {verdict(pickedPlayer.name)}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.dock}>
        <Pressable
          onPress={spin}
          disabled={spectator || spinning}
          style={({ pressed }) => [
            styles.action,
            pressed || spinning ? styles.pressed : null,
            spectator ? styles.muted : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel={pickedPlayer ? `${action} znovu` : action}
          accessibilityState={{ disabled: spectator || spinning }}
        >
          <Text
            style={styles.actionText}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {spinning ? "…" : pickedPlayer ? "Znovu" : action}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: MockLayout.screenPad },
  pressed: { opacity: 0.8 },
  muted: { backgroundColor: withAlpha(Colors.amber, 0.35) },
  stage: { flex: 1, justifyContent: "flex-end" },
  verdict: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: Spacing.xl,
    alignItems: "center",
    gap: Spacing.sm,
  },
  verdictText: {
    fontSize: 30,
    fontWeight: "800",
    color: Colors.foam,
    textAlign: "center",
    letterSpacing: -0.5,
    textShadowColor: withAlpha(Colors.black, 0.9),
    textShadowRadius: 14,
  },
  action: {
    alignSelf: "center",
    height: 54,
    paddingHorizontal: 44,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  actionText: { ...MockType.buttonLabel, color: Colors.stout },
  dock: { flexDirection: "row", gap: 10 },
});
