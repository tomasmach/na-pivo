/**
 * A game whose whole job is to point at somebody — Flaška.
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
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  GAME_HOST_AVAILABLE,
  GameHost,
  type GameHostHandle,
} from "@/games/GameHost";
import { GameResult, type GameOutcome } from "@/games/GameResult";
import { t } from "@/i18n";
import { GameArtwork } from "@/party/GameArtwork";
import { bottleTableSvg } from "@/party/bottleTableArtwork";
import { displayPersonName } from "@/party/nightBuilder";
import {
  GameStage,
  STAGE_FILL,
  StagePill,
  StageStatus,
  stageBody,
} from "@/party/shells/GameStage";
import { Spacing } from "@/theme/layout";

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
  /** Which canvas page to host. */
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
   * deliberately released by the valid `picked` event before the canvas
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
  const verdictText = pickedPlayer ? verdict(pickedPlayer.name) : null;
  // The pick's spoken identity: same player at a new revision is a new result.
  const resultKey =
    pickedPlayer && verdictText
      ? `${pickedPlayer.id}:${effectiveRevision}`
      : null;
  React.useEffect(() => {
    interactionLocked.current = false;
    if (fallbackUnlock.current) {
      clearTimeout(fallbackUnlock.current);
      fallbackUnlock.current = null;
    }
  }, [effectivePickedId, effectiveRevision]);
  const announcedResult = React.useRef<string | null>(resultKey);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (!resultKey || !verdictText) {
      announcedResult.current = null;
      return;
    }
    if (announcedResult.current === resultKey) return;
    announcedResult.current = resultKey;
    AccessibilityInfo.announceForAccessibility?.(verdictText);
  }, [resultKey, verdictText]);
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
    <View style={stageBody(insets.bottom)}>
      <GameStage>
        {canvas ? (
          <View style={styles.canvas}>
          <GameHost
            ref={host}
            game={game}
            // The canvas gets identity and colour only. Names stay in the
            // native verdict layer where Dynamic Type and screen readers work.
            players={players.map((player) => ({
              id: player.id,
              colour: player.tint,
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
          </View>
        ) : (
          <>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <SvgXml xml={bottleTableSvg} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
            </View>
            <GameArtwork gameKey="bottle" size={240} />
          </>
        )}
      </GameStage>

      {/* The name, UNDER the table rather than over it. Printed on top it landed
          across the seat markers and the bottle it is talking about; the answer
          and the thing that produced it must not fight for the same pixels. */}
      {pickedPlayer && verdictText ? (
        <Animated.View
          key={`${pickedPlayer.id}:${effectiveRevision}`}
          entering={FadeIn.duration(220)}
          pointerEvents="none"
        >
          <StageStatus
            name={displayPersonName(pickedPlayer.name)}
            tint={pickedPlayer.tint}
            text={verdictText}
          />
        </Animated.View>
      ) : null}

      <View style={styles.dock}>
        <StagePill
          label={spinning ? "…" : pickedPlayer ? t.gameShell.again : action}
          onPress={spin}
          disabled={spectator || spinning}
          tone={spectator ? "muted" : "primary"}
          accessibilityLabel={pickedPlayer ? t.gameShell.againAction(action) : action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** The canvas owns the whole playfield; the stage owns its frame. */
  canvas: STAGE_FILL,
  dock: { marginTop: "auto", paddingTop: Spacing.lg },
});
