/**
 * How every game ends — one screen, a few shapes.
 *
 * The result is the platform's, not the game's (§18.11a): it carries names and
 * faces, it has to look the same whichever game produced it, and the same data
 * is read again by the thread, the recap and the feed. A game reports `result`
 * and stops; this draws it.
 *
 * The shape is chosen from the DATA, not from a flag the game passes:
 *
 *   payer    somebody is buying — the loudest ending this app has
 *   winner   somebody won on points
 *   board    two or more scores, so the ranking is the story
 *   none     played, decided nothing. A perfectly good way for a night to go.
 *
 * Both halves are derived. One name at the top comes from `payingId` or
 * `winnerId`; the table under it appears when the game returned more than one
 * score and stays away when it did not. A game that picks a single person sends
 * no scores and gets a single face; a quiz sends five and gets a ranking, with
 * the winner still called out above it. Neither has to say which it wants.
 *
 * Derived rather than declared on purpose. A `variant` prop is a thing a game
 * can get wrong; "there is a `payingId`, so somebody is paying" cannot be.
 *
 * A drinking game reaches `none` or `payer` and never `winner`, because the only
 * ranking it could produce is who drank most — the one scoreboard this product
 * must never print.
 */

import React from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { cs } from '@/i18n/cs';
import type { GameScore } from '@/games/protocol';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export interface ResultPlayer {
  id?: string;
  name: string;
  tint: string;
}

export type ResultPlayerReference =
  | { kind: 'id'; value: string }
  | { kind: 'name'; value: string };

type ResultScore = Omit<GameScore, 'playerId'> & {
  playerId: string | ResultPlayerReference;
};

export interface GameOutcome {
  scores: ResultScore[];
  winnerId: string | ResultPlayerReference | null;
  payingId?: string | ResultPlayerReference | null;
}

/** Stable ids win; tagged legacy names can never be reinterpreted as ids. */
function resolvePlayer(
  players: ResultPlayer[],
  reference: string | ResultPlayerReference,
): ResultPlayer | undefined {
  if (typeof reference === 'object') {
    return reference.kind === 'id'
      ? players.find((player) => player.id === reference.value)
      : players.find((player) => player.name === reference.value);
  }
  return players.find((player) => player.id === reference)
    ?? players.find((player) => player.name === reference);
}

function referenceValue(reference: string | ResultPlayerReference): string {
  return typeof reference === 'string' ? reference : reference.value;
}

/** What the ending is called, and the line under it. */
function headline(outcome: GameOutcome, players: ResultPlayer[]): { title: string; note: string } {
  const nameOf = (reference: string | ResultPlayerReference) =>
    resolvePlayer(players, reference)?.name ?? referenceValue(reference);
  if (outcome.payingId) {
    const name = nameOf(outcome.payingId);
    return {
      title: name === 'Ty' ? cs.gameResult.payingSelf : cs.gameResult.payingOther(name),
      note: cs.gameResult.payingNote,
    };
  }
  if (outcome.winnerId) {
    const name = nameOf(outcome.winnerId);
    return {
      title: name === 'Ty' ? cs.gameResult.winningSelf : cs.gameResult.winningOther(name),
      note: cs.gameResult.winningNote,
    };
  }
  return { title: cs.gameResult.done, note: cs.gameResult.doneNote };
}

export function GameResult({
  players,
  outcome,
  /** Ranked, best first. Empty for games that keep no score. */
  board,
  onDone,
  doneLabel = 'Konec',
}: {
  players: ResultPlayer[];
  outcome: GameOutcome;
  board?: {
    playerId?: string | ResultPlayerReference;
    name: string;
    score: number;
    suffix?: string;
  }[];
  onDone: () => void;
  doneLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { title, note } = headline(outcome, players);
  const playerOf = (reference: string | ResultPlayerReference) =>
    resolvePlayer(players, reference);

  // One score is not a ranking, and zero is not a table. The game says how many
  // people its ending is about simply by how many it scored.
  const ranking: {
    key: string;
    name: string;
    score: number;
    suffix?: string;
    tint: string;
  }[] =
    board
      ? board.map((row, index) => ({
          ...row,
          key: row.playerId ? referenceValue(row.playerId) : `${row.name}-${index}`,
          tint:
            (row.playerId ? playerOf(row.playerId) : undefined)?.tint ??
            players.find((player) => player.name === row.name)?.tint ??
            Colors.amber,
        }))
      : outcome.scores.length > 1
      ? [...outcome.scores]
          .sort((a, b) => b.score - a.score)
          .map((row, index) => {
            const player = playerOf(row.playerId);
            return {
              key: player?.id ?? `${referenceValue(row.playerId)}-${index}`,
              name: player?.name ?? referenceValue(row.playerId),
              score: row.score,
              tint: player?.tint ?? Colors.amber,
            };
          })
      : [];
  const starId = outcome.payingId ?? outcome.winnerId ?? null;
  const starPlayer = starId ? playerOf(starId) : undefined;
  const star = starId ? (starPlayer?.name ?? referenceValue(starId)) : null;
  const starTint = starPlayer?.tint ?? Colors.amber;

  // iOS reads the whole grouped summary imperatively, once per genuinely new
  // label; Android gets the declarative assertive live region on the node.
  const summaryLabel = `${title}. ${note}`;
  const announcedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (announcedRef.current === summaryLabel) return;
    announcedRef.current = summaryLabel;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility?.(summaryLabel);
  }, [summaryLabel]);

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(260)} style={styles.body}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {title === cs.gameResult.done ? null : (
          <Text style={styles.kicker} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.gameResult.done}
          </Text>
        )}

        {/* One focusable summary instead of three fragmented nodes; the
            label reuses only what is already on screen. */}
        <View
          style={styles.star}
          accessible
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={summaryLabel}
        >
          {star ? <PersonAvatar name={star} tint={starTint} size={72} /> : null}
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {title}
          </Text>
          <Text style={styles.note} maxFontSizeMultiplier={FontScaleCap.body}>
            {note}
          </Text>
        </View>

        {ranking.length > 0 ? (
          <View style={styles.board}>
            {ranking.map((row, index) => (
              <Animated.View
                key={row.key ?? `${row.name}-${index}`}
                entering={reduceMotion ? undefined : FadeInDown.delay(index * 60).duration(220)}
                style={[styles.row, index === 0 && styles.rowTop]}
                accessible
                accessibilityLabel={`${index + 1}. ${row.name} ${row.suffix ?? row.score}`}
              >
                <Text style={styles.rank} allowFontScaling={false}>
                  {index + 1}
                </Text>
                <PersonAvatar name={row.name} tint={row.tint ?? Colors.amber} size={30} />
                <Text
                  style={styles.name}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {row.name}
                </Text>
                <Text style={styles.score} allowFontScaling={false}>
                  {row.suffix ?? row.score}
                </Text>
              </Animated.View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.dock, { marginBottom: insets.bottom + Spacing.sm }]}>
        <Pressable
          onPress={onDone}
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={doneLabel}
        >
          <Text style={styles.doneText} maxFontSizeMultiplier={FontScaleCap.heading}>
            {doneLabel}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingTop: Spacing.lg,
  },
  scroll: { flex: 1, alignSelf: 'stretch' },
  content: {
    flexGrow: 1,
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.lg,
    alignItems: 'center',
  },
  pressed: { opacity: 0.8 },
  kicker: { fontSize: 13, fontWeight: '700', color: Colors.mutedText },

  star: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xxl },
  title: {
    fontFamily: Fonts.numeral,
    fontSize: 32,
    lineHeight: 40,
    includeFontPadding: false,
    color: Colors.amber,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  note: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.mutedText,
    textAlign: 'center',
  },

  board: { alignSelf: 'stretch', marginTop: Spacing.xxl, gap: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 52,
    paddingHorizontal: Spacing.md,
    borderRadius: 18,
    backgroundColor: MockColors.surfaceHigh,
  },
  rowTop: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  rank: {
    minWidth: 18,
    fontFamily: Fonts.numeral,
    fontSize: 17,
    lineHeight: 21,
    includeFontPadding: false,
    color: Colors.mutedText,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.foam },
  score: {
    fontFamily: Fonts.numeral,
    fontSize: 20,
    lineHeight: 25,
    includeFontPadding: false,
    color: Colors.foam,
  },

  dock: {
    marginTop: 'auto',
    marginHorizontal: MockLayout.screenPad,
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
  },
  done: {
    flex: 1,
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  doneText: { ...MockType.buttonLabel, color: Colors.stout },
});
