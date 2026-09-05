/**
 * Pub kvíz — každý na svém telefonu.
 *
 * This is the first game that is genuinely multi-device, and that changes what
 * the screen is. The others put one phone in the middle of the table; here every
 * phone shows the same question at the same moment and each one is answering for
 * itself. So this file draws exactly one player's view of a shared question and
 * never pretends to know more than that phone can see.
 *
 * Three beats per question, and the middle one is the point of the game:
 *
 *   ptá se     the question and four options, all tappable
 *   zamknuto   you have answered; who else has not, is the only thing left to
 *              show. Locked, not editable — a quiz where you can change your
 *              answer while watching the others is not a quiz.
 *   odhaleno   the right answer, once everybody has committed
 *
 * Waiting is deliberately its own beat. Revealing the moment YOU answer would
 * mean the fastest person at the table can read the answer out loud, and a pub
 * is not a place where that stays theoretical.
 *
 * The rules live in `@/party/quiz/rules` and are a fold over an append-only list
 * of answers — the same shape the backend stores and the same shape the stream
 * delivers. This component holds no derived state of its own: it renders
 * `quizState(...)` and hands taps up. That is what lets the answers come from
 * local state today and from `partyGamesStream` tomorrow without a rewrite.
 */

import React from "react";
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckIcon } from "@/components/shared/IconGlyph";
import { GameResult } from "@/games/GameResult";
import { t } from "@/i18n";
import { GameArtwork } from "@/party/GameArtwork";
import { displayPersonName } from "@/party/nightBuilder";
import {
  GameStage,
  StageCard,
  StageChip,
  StageChips,
  StageInk,
  StagePill,
  StageStatus,
  stageBody,
} from "@/party/shells/GameStage";
import { DurableFinishPending, useDurableFinish } from "@/party/shells/DurableFinish";
import { QUIZ_QUESTIONS } from "@/party/quiz/questions";
import {
  hasAnswered,
  quizState,
  quizWinner,
  teamsOf,
  type QuizAnswer,
  type QuizEntrant,
} from "@/party/quiz/rules";
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap, Fonts } from "@/theme/fonts";
import { Radius, Spacing } from "@/theme/layout";

/** Bounds an optimistic answer lock whose canonical answer never arrives. */
const LOCK_RECOVERY_MS = 1200;

export function QuizShell({
  entrants,
  answers,
  me,
  index,
  tintOf,
  forceRevealed = false,
  spectator = false,
  onAnswer,
  onReveal,
  onNext,
  onFinished,
  onDone,
}: {
  entrants: QuizEntrant[];
  /** Everything anybody has answered so far. Order does not matter. */
  answers: QuizAnswer[];
  /** Which entrant this phone is. */
  me: string;
  index: number;
  tintOf: (playerId: string) => string;
  /** Somebody gave up waiting for a phone that is not coming back. */
  forceRevealed?: boolean;
  /** Watch-only phone: sees the shared question, never answers or advances. */
  spectator?: boolean;
  onAnswer: (option: number) => void;
  onReveal: () => void;
  onNext: () => void;
  onFinished: (result: {
    winner: string | null;
    winnerId: string | null;
    standings: { name: string; playerId: string; score: number }[];
  }) => Promise<boolean>;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const state = quizState({ entrants, answers, index });
  const question = state.question;
  const answerLocked = React.useRef<string | null>(null);
  const answerUnlock = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    answerLocked.current = null;
    if (answerUnlock.current) {
      clearTimeout(answerUnlock.current);
      answerUnlock.current = null;
    }
  }, [question?.id]);
  React.useEffect(
    () => () => {
      if (answerUnlock.current) clearTimeout(answerUnlock.current);
    },
    [],
  );
  const locked = question
    ? hasAnswered(answers, entrants, me, question.id)
    : false;
  // Everybody has committed, so nobody can be helped by hearing it out loud.
  const revealed = state.complete || forceRevealed;
  const playingHere = entrants.some((entrant) => entrant.id === me);
  const canAnswer = playingHere && !locked && !revealed && !spectator;
  const visibleStandings = revealed ? state.standings : state.previousStandings;
  const mine = question
    ? answers.find(
        (answer) =>
          answer.entrantId === me && answer.questionId === question.id,
      )
    : undefined;

  const finishWinnerId = state.finished ? quizWinner(state.standings) : null;
  const finishResult = state.finished
    ? {
      winner: finishWinnerId
        ? (state.standings.find((row) => row.teamId === finishWinnerId)?.teamName ?? null)
        : null,
      winnerId: finishWinnerId,
      standings: state.standings.map((row) => ({
        name: row.teamName,
        playerId: row.teamId,
        score: row.score,
      })),
    }
    : null;
  const durableFinish = useDurableFinish({
    finished: state.finished,
    spectator,
    resultKey: finishResult ? JSON.stringify(finishResult) : null,
    result: finishResult,
    onFinished,
  });

  /** Teams still thinking. Named, because "3 čekají" makes nobody hurry. */
  const waiting = state.standings
    .filter((row) => !state.answered.includes(row.teamId))
    .map((row) => displayPersonName(row.teamName));
  const waitingLine = question
    ? t.gameShell.quizWaiting(waiting.join(", "))
    : null;
  const shownWaitingLine = locked && !revealed ? waitingLine : null;
  const correctLabel =
    question && revealed
      ? t.gameShell.quizCorrect(question.options[question.answer] ?? "")
      : null;

  // accessibilityLiveRegion never fires on iOS, so the same beats are announced
  // imperatively there — keyed by what is already audible, so a mount or a
  // reconnect never repeats a line that has not changed.
  const announcedQuestion = React.useRef(question?.id ?? null);
  React.useEffect(() => {
    if (Platform.OS !== "ios" || !question) return;
    if (announcedQuestion.current === question.id) return;
    announcedQuestion.current = question.id;
    AccessibilityInfo.announceForAccessibility?.(question.text);
  }, [question]);

  const announcedWaiting = React.useRef(shownWaitingLine);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (announcedWaiting.current === shownWaitingLine) return;
    announcedWaiting.current = shownWaitingLine;
    if (shownWaitingLine)
      AccessibilityInfo.announceForAccessibility?.(shownWaitingLine);
  }, [shownWaitingLine]);

  const revealedForQuestion = question && revealed ? question.id : null;
  const announcedReveal = React.useRef(revealedForQuestion);
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    if (announcedReveal.current === revealedForQuestion) return;
    announcedReveal.current = revealedForQuestion;
    if (revealedForQuestion && correctLabel)
      AccessibilityInfo.announceForAccessibility?.(correctLabel);
  }, [revealedForQuestion, correctLabel]);

  if (state.finished) {
    if (durableFinish.status !== "stored") {
      return (
        <DurableFinishPending
          status={durableFinish.status}
          spectator={spectator}
          onRetry={durableFinish.retry}
        />
      );
    }
    return (
      <GameResult
        players={teamsOf(entrants).map((team) => ({
          id: team.id,
          name: team.name,
          tint: tintOf(team.id),
        }))}
        outcome={{
          scores: state.standings.map((row) => ({
            playerId: row.teamId,
            score: row.score,
          })),
          winnerId: quizWinner(state.standings),
        }}
        onDone={onDone}
      />
    );
  }
  if (!question) return null;

  const tile = (optionIndex: number) => {
    const option = question.options[optionIndex];
    const right = revealed && optionIndex === question.answer;
    const wrong = revealed && mine?.option === optionIndex && !right;
    const picked = mine?.option === optionIndex;
    return (
      <Pressable
        key={option}
        onPress={() => {
          if (!canAnswer || answerLocked.current === question.id) return;
          answerLocked.current = question.id;
          // Canonical answers unlock us; bound the lock in case this answer
          // never lands anywhere.
          if (answerUnlock.current) clearTimeout(answerUnlock.current);
          const atQuestion = question.id;
          answerUnlock.current = setTimeout(() => {
            if (answerLocked.current === atQuestion) answerLocked.current = null;
          }, LOCK_RECOVERY_MS);
          onAnswer(optionIndex);
        }}
        disabled={!canAnswer}
        style={({ pressed }) => [
          styles.tile,
          picked && styles.tilePicked,
          right && styles.tileRight,
          wrong && styles.tileWrong,
          pressed && canAnswer && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canAnswer, selected: picked }}
        accessibilityLiveRegion={revealed && right ? "assertive" : undefined}
        accessibilityLabel={
          revealed && right ? (correctLabel ?? undefined) : option
        }
      >
        <View style={styles.tileTop}>
          <Text
            style={[styles.letter, picked && styles.letterOn]}
            allowFontScaling={false}
          >
            {LETTERS[optionIndex]}
          </Text>
          {right ? <CheckIcon size={16} color={Colors.success} /> : null}
        </View>
        <Text
          style={[styles.tileText, picked && styles.tileTextOn]}
          numberOfLines={3}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {option}
        </Text>
      </Pressable>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      style={styles.body}
      showsVerticalScrollIndicator={false}
      // Locking mid-question would leave a half-scrolled option under the thumb.
      keyboardShouldPersistTaps="handled"
    >
      <View style={stageBody(insets.bottom)}>
        <GameStage
          topRight={
            <StageChip label={`${index + 1}/${QUIZ_QUESTIONS.length}`} />
          }
          style={styles.stage}
        >
          <StageCard wide style={styles.questionCard}>
            <View style={styles.quizArt}><GameArtwork gameKey="quiz" size={64} /></View>
            <Animated.Text
              key={question.id}
              entering={reduceMotion ? undefined : FadeIn.duration(220)}
              style={styles.question}
              maxFontSizeMultiplier={FontScaleCap.heading}
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
            >
              {question.text}
            </Animated.Text>
          </StageCard>

          {/* Four tiles, two by two, taking everything the question card
              left behind. A vertical list of four rows read as a settings
              screen; four equal slabs read as a game you tap fast, and the tap
              target is as big as the table allows. */}
          <View style={styles.grid}>
            {[0, 2].map((start) => (
              <View key={start} style={styles.gridRow}>
                {tile(start)}
                {tile(start + 1)}
              </View>
            ))}
          </View>
        </GameStage>

        {/* Locked but not yet revealed: the only honest thing to show is who the
            table is still waiting for. Nominative, so it reads right however the
            table is named — "čeká se na Honza" is the kind of Czech an app
            writes and a person never does. */}
        {locked && !revealed && waitingLine ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(200)}
          >
            <StageStatus text={waitingLine} />
          </Animated.View>
        ) : null}

        {visibleStandings.length > 1 ? (
          <StageChips
            players={visibleStandings.map((row) => ({
              id: row.teamId,
              name: displayPersonName(row.teamName),
              tint: tintOf(row.teamId),
              score: row.score,
            }))}
          />
        ) : null}

        <View style={styles.dock}>
          {/* Somebody is at the bar, or their phone died. A quiz that can only
              be unblocked by a person who left is a quiz that ends there. */}
          {locked && !revealed && !spectator ? (
            <StagePill
              label={t.gameShell.quizSkipWait}
              tone="quiet"
              onPress={onReveal}
              accessibilityLabel={t.gameShell.quizSkipWaitA11y}
            />
          ) : null}

          {revealed && !spectator ? (
            <StagePill
              label={
                index + 1 >= QUIZ_QUESTIONS.length
                  ? t.gameShell.quizResults
                  : t.gameShell.quizNextQuestion
              }
              onPress={onNext}
              accessibilityLabel={t.gameShell.quizNextQuestion}
            />
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

/** The four tiles are lettered, so a table can shout "béčko" across the noise. */
const LETTERS = ["A", "B", "C", "D"] as const;

const styles = StyleSheet.create({
  body: { flex: 1 },
  scroll: { flexGrow: 1 },
  pressed: { opacity: 0.8 },

  stage: { padding: Spacing.md, justifyContent: "flex-start" },
  questionCard: { marginTop: Spacing.xl },
  quizArt: { alignItems: "center", marginBottom: Spacing.xs },
  question: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    color: StageInk.strong,
    letterSpacing: -0.3,
    textAlign: "center",
  },

  grid: {
    flex: 1,
    alignSelf: "stretch",
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  gridRow: { flex: 1, flexDirection: "row", gap: Spacing.sm },
  tile: {
    flex: 1,
    minHeight: 84,
    padding: Spacing.md,
    borderRadius: Radius.medium,
    justifyContent: "space-between",
    backgroundColor: Colors.stout3,
    borderWidth: 2,
    borderColor: "transparent",
  },
  // Tinted, not filled: the one full amber plane on the screen is the pill
  // (§2.2), and a chosen answer is a state, not a call to action.
  tilePicked: {
    backgroundColor: withAlpha(Colors.amber, 0.2),
    borderColor: Colors.amber,
  },
  tileRight: { borderColor: Colors.success },
  tileWrong: { backgroundColor: withAlpha(StageInk.red, 0.24) },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  letter: {
    fontFamily: Fonts.numeral,
    fontSize: 14,
    lineHeight: 18,
    includeFontPadding: false,
    color: Colors.mutedText,
  },
  letterOn: { color: Colors.amber },
  tileText: { fontSize: 17, fontWeight: "700", color: Colors.foam },
  tileTextOn: { color: Colors.foam },

  dock: { marginTop: "auto", paddingTop: Spacing.lg, gap: Spacing.sm },
});
