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

export interface GameOutcome {
  scores: GameScore[];
  winnerId: string | null;
  payingId?: string | null;
}

/** What the ending is called, and the line under it. */
function headline(outcome: GameOutcome, players: ResultPlayer[]): { title: string; note: string } {
  const nameOf = (value: string) =>
    players.find((player) => player.id === value || player.name === value)?.name ?? value;
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
  board?: { name: string; score: number; suffix?: string }[];
  onDone: () => void;
  doneLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { title, note } = headline(outcome, players);
  const playerOf = (value: string) =>
    players.find((player) => player.id === value || player.name === value);

  // One score is not a ranking, and zero is not a table. The game says how many
  // people its ending is about simply by how many it scored.
  const ranking: { name: string; score: number; suffix?: string }[] =
    board ??
    (outcome.scores.length > 1
      ? [...outcome.scores]
          .sort((a, b) => b.score - a.score)
          .map((row) => ({
            name: playerOf(row.playerId)?.name ?? row.playerId,
            score: row.score,
          }))
      : []);
  const starId = outcome.payingId ?? outcome.winnerId ?? null;
  const star = starId ? (playerOf(starId)?.name ?? starId) : null;
  const tintOf = (name: string) => playerOf(name)?.tint ?? Colors.amber;

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
          {star ? <PersonAvatar name={star} tint={tintOf(star)} size={72} /> : null}
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
                key={`${row.name}-${index}`}
                entering={reduceMotion ? undefined : FadeInDown.delay(index * 60).duration(220)}
                style={[styles.row, index === 0 && styles.rowTop]}
                accessible
                accessibilityLabel={`${index + 1}. ${row.name} ${row.suffix ?? row.score}`}
              >
                <Text style={styles.rank} allowFontScaling={false}>
                  {index + 1}
                </Text>
                <PersonAvatar name={row.name} tint={tintOf(row.name)} size={30} />
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
    fontSize: 32,
    fontWeight: '800',
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
    color: Colors.mutedText,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.foam },
  score: { fontFamily: Fonts.numeral, fontSize: 20, color: Colors.foam },

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
