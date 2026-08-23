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

import { CheckIcon } from "@/components/shared/IconGlyph";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { GameResult } from "@/games/GameResult";
import { QUIZ_QUESTIONS } from "@/party/quiz/questions";
import {
  hasAnswered,
  quizState,
  quizWinner,
  type QuizAnswer,
  type QuizEntrant,
} from "@/party/quiz/rules";
import { MockColors, MockLayout, MockType } from "@/mocks/mockTheme";
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
  tintOf: (name: string) => string;
  /** Somebody gave up waiting for a phone that is not coming back. */
  forceRevealed?: boolean;
  /** Watch-only phone: sees the shared question, never answers or advances. */
  spectator?: boolean;
  onAnswer: (option: number) => void;
  onReveal: () => void;
  onNext: () => void;
  onFinished: (result: {
    winner: string | null;
    standings: { name: string; score: number }[];
  }) => void;
  onDone: () => void;
}) {
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

  const reported = React.useRef(false);
  React.useEffect(() => {
    if (!state.finished || reported.current || spectator) return;
    reported.current = true;
    onFinished({
      winner: quizWinner(state.standings)
        ? (state.standings.find(
            (row) => row.teamId === quizWinner(state.standings),
          )?.teamName ?? null)
        : null,
      standings: state.standings.map((row) => ({
        name: row.teamName,
        score: row.score,
      })),
    });
  }, [state.finished, state.standings, onFinished, spectator]);

  /** Teams still thinking. Named, because "3 čekají" makes nobody hurry. */
  const waiting = state.standings
    .filter((row) => !state.answered.includes(row.teamId))
    .map((row) => row.teamName);
  const waitingLine = question
    ? `Zamknuto. Chybí ${waiting.join(", ")}`
    : null;
  const shownWaitingLine = locked && !revealed ? waitingLine : null;
  const correctLabel =
    question && revealed
      ? `${question.options[question.answer]} — správně`
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
    return (
      <GameResult
        players={entrants.map((entrant) => ({
          name: entrant.teamName,
          tint: tintOf(entrant.teamName),
        }))}
        outcome={{
          scores: state.standings.map((row) => ({
            playerId: row.teamName,
            score: row.score,
          })),
          winnerId:
            state.standings.find(
              (row) => row.teamId === quizWinner(state.standings),
            )?.teamName ?? null,
        }}
        onDone={onDone}
      />
    );
  }
  if (!question) return null;

  return (
    <ScrollView
      contentContainerStyle={styles.body}
      showsVerticalScrollIndicator={false}
      // Locking mid-question would leave a half-scrolled option under the thumb.
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.kicker} maxFontSizeMultiplier={FontScaleCap.body}>
        Otázka {index + 1}/{QUIZ_QUESTIONS.length}
      </Text>

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

      <View style={styles.options}>
        {question.options.map((option, optionIndex) => {
          const right = revealed && optionIndex === question.answer;
          const wrong = revealed && mine?.option === optionIndex && !right;
          const picked = mine?.option === optionIndex;
          return (
            <Pressable
              key={option}
              onPress={() => {
                if (!canAnswer || answerLocked.current === question.id) return;
                answerLocked.current = question.id;
                // Canonical answers unlock us; bound the lock in case this
                // answer never lands anywhere.
                if (answerUnlock.current) clearTimeout(answerUnlock.current);
                const atQuestion = question.id;
                answerUnlock.current = setTimeout(() => {
                  if (answerLocked.current === atQuestion)
                    answerLocked.current = null;
                }, LOCK_RECOVERY_MS);
                onAnswer(optionIndex);
              }}
              disabled={!canAnswer}
              style={({ pressed }) => [
                styles.option,
                picked && styles.optionPicked,
                right && styles.optionRight,
                wrong && styles.optionWrong,
                pressed && canAnswer && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canAnswer, selected: picked }}
              accessibilityLiveRegion={
                revealed && right ? "assertive" : undefined
              }
              accessibilityLabel={
                revealed && right
                  ? (correctLabel ?? undefined)
                  : option
              }
            >
              <Text
                style={[
                  styles.optionText,
                  (right || picked) && styles.optionTextOn,
                ]}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {option}
              </Text>
              {right ? <CheckIcon size={18} color={Colors.stout} /> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Locked but not yet revealed: the only honest thing to show is who the
          table is still waiting for. */}
      {locked && !revealed ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(200)}
          style={styles.waiting}
        >
          <Text
            style={styles.waitingTitle}
            maxFontSizeMultiplier={FontScaleCap.body}
            accessibilityLiveRegion="polite"
          >
            {/* Nominative, so it reads right however the table is named —
                "čeká se na Honza" is the kind of Czech an app writes and a
                person never does. */}
            {waitingLine}
          </Text>
          {/* Somebody is at the bar, or their phone died. A quiz that can only
              be unblocked by a person who left is a quiz that ends there. */}
          {!spectator ? (
            <Pressable
              onPress={onReveal}
              style={({ pressed }) => [
                styles.reveal,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Ukázat odpověď bez čekání"
              hitSlop={8}
            >
              <Text
                style={styles.revealText}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                Nečekat
              </Text>
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      {revealed && !spectator ? (
        <Pressable
          onPress={onNext}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Další otázka"
        >
          <Text
            style={styles.actionText}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {index + 1 >= QUIZ_QUESTIONS.length ? "Výsledky" : "Další otázka"}
          </Text>
        </Pressable>
      ) : null}

      {/* The board is context, not the question — quiet, at the bottom, and only
          when there is somebody to compare with. */}
      {visibleStandings.length > 1 ? (
        <View style={styles.board}>
          {visibleStandings.map((row) => (
            <View
              key={row.teamId}
              style={styles.boardRow}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${row.teamName} ${row.score}`}
            >
              <PersonAvatar
                name={row.teamName}
                tint={tintOf(row.teamName)}
                size={22}
              />
              <Text
                style={styles.boardName}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {row.teamName}
              </Text>
              <Text
                style={styles.boardScore}
                allowFontScaling={false}
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {row.score}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  pressed: { opacity: 0.8 },
  kicker: { fontSize: 13, fontWeight: "700", color: Colors.mutedText },
  question: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: "800",
    color: Colors.foam,
    letterSpacing: -0.4,
    marginTop: Spacing.sm,
  },

  options: { marginTop: Spacing.xl, gap: Spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 60,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 18,
    backgroundColor: MockColors.surfaceHigh,
  },
  optionPicked: { backgroundColor: withAlpha(Colors.amber, 0.18) },
  optionRight: { backgroundColor: Colors.amber },
  optionWrong: { backgroundColor: withAlpha(Colors.foam, 0.06) },
  optionText: { flex: 1, fontSize: 17, fontWeight: "600", color: Colors.foam },
  optionTextOn: { color: Colors.stout, fontWeight: "700" },

  waiting: { marginTop: Spacing.lg, alignItems: "center", gap: Spacing.sm },
  reveal: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
  revealText: { fontSize: 14, fontWeight: "700", color: Colors.amber },
  waitingTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.mutedText,
    textAlign: "center",
  },

  action: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.xl,
    backgroundColor: Colors.amber,
  },
  actionText: { ...MockType.buttonLabel, color: Colors.stout },

  board: { marginTop: Spacing.xxl, gap: Spacing.sm },
  boardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  boardName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: withAlpha(Colors.foam, 0.75),
  },
  boardScore: {
    fontFamily: Fonts.numeral,
    fontSize: 17,
    color: Colors.foam,
    fontVariant: ["tabular-nums"],
  },
});
