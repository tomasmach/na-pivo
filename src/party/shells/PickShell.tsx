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

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { Face } from '@/feed/FeedMockScreen';
import { GAME_HOST_AVAILABLE, GameHost, type GameHostHandle } from '@/games/GameHost';
import { GameResult, type GameOutcome } from '@/games/GameResult';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export interface PickPlayer {
  name: string;
  tint: string;
}

/** Module scope so `react-hooks/purity` can see this is a tap, not render. */
const pickOne = (players: PickPlayer[]): string =>
  players[Math.floor(Math.random() * players.length)]?.name ?? '';

export function PickShell({
  game,
  players,
  action,
  /** What to say once somebody has been chosen. */
  verdict,
  onFinished,
  onDone,
}: {
  /** Which page to host: `bottle`, `wheel`. */
  game: string;
  players: PickPlayer[];
  action: string;
  verdict: (name: string) => string;
  /** Only for games that end on the first pick. */
  onFinished?: (payingName: string) => void;
  /** Leaving a finished game. Absent for games that never end, like Flaška. */
  onDone?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const host = React.useRef<GameHostHandle>(null);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [spinning, setSpinning] = React.useState(false);
  /** Set only by games that end — Flaška never does. */
  const [outcome, setOutcome] = React.useState<GameOutcome | null>(null);

  const canvas = GAME_HOST_AVAILABLE && !reduceMotion;

  const spin = () => {
    if (spinning) return;
    if (!canvas) {
      // No object to watch, so no spin to wait for. Same answer, no theatre.
      const name = pickOne(players);
      setPicked(name);
      onFinished?.(name);
      if (onDone) setOutcome({ scores: [], winnerId: null, payingId: name });
      return;
    }
    setSpinning(true);
    setPicked(null);
    host.current?.command('spin');
  };

  const tintOf = (name: string) =>
    players.find((player) => player.name === name)?.tint ?? Colors.amber;

  // A game that ended hands over to the platform's ending, the same one the
  // dice land on.
  if (outcome && onDone) {
    return <GameResult players={players} outcome={outcome} onDone={onDone} />;
  }

  return (
    <View style={styles.body}>
      <View style={styles.stage}>
        {canvas ? (
          <GameHost
            ref={host}
            game={game}
            // The label is painted on the wheel; the sentence under it is still
            // React Native. See the note on `GamePlayer.label`.
            players={players.map((player) => ({
              id: player.name,
              colour: player.tint,
              label: player.name,
            }))}
            onEvent={(name, payload) => {
              if (name !== 'picked') return;
              setSpinning(false);
              setPicked((payload as { playerId: string }).playerId);
            }}
            onResult={(result) => {
              setOutcome(result);
              if (result.payingId) onFinished?.(result.payingId);
            }}
          />
        ) : null}

        {/* The name, over the object. Real text, so it scales and speaks. */}
        {picked ? (
          <Animated.View
            key={picked}
            entering={FadeIn.duration(220)}
            style={styles.verdict}
            pointerEvents="none"
          >
            <Face name={picked} tint={tintOf(picked)} size={44} />
            <Text style={styles.verdictText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {verdict(picked)}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      <Pressable
        onPress={spin}
        disabled={spinning}
        style={({ pressed }) => [styles.action, (pressed || spinning) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={action}
      >
        <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.heading}>
          {spinning ? '…' : picked ? 'Znovu' : action}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.lg },
  pressed: { opacity: 0.8 },
  stage: { flex: 1, justifyContent: 'flex-end' },
  verdict: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  verdictText: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.foam,
    textAlign: 'center',
    letterSpacing: -0.5,
    textShadowColor: withAlpha(Colors.black, 0.9),
    textShadowRadius: 14,
  },
  action: {
    alignSelf: 'center',
    height: 54,
    paddingHorizontal: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  actionText: { ...MockType.buttonLabel, color: Colors.stout },
});
