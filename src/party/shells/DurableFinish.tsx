import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { cs } from "@/i18n/cs";
import { Colors } from "@/theme/colors";
import { FontScaleCap } from "@/theme/fonts";
import { Radius, Spacing } from "@/theme/layout";

export type DurableFinishStatus = "idle" | "saving" | "failed" | "stored";

/**
 * A terminal game state is only a candidate result until its finish event is
 * durably stored. Capture that exact candidate once, serialize attempts, and
 * expose an explicit retry after false/reject instead of letting a generic end
 * action replace it.
 */
export function useDurableFinish<Result>({
  finished,
  spectator,
  resultKey,
  result,
  onFinished,
}: {
  finished: boolean;
  spectator: boolean;
  resultKey: string | null;
  result: Result | null;
  onFinished: (result: Result) => Promise<boolean>;
}) {
  const key = finished && result ? resultKey : null;
  const [finish, setFinish] = React.useState<{
    key: string | null;
    result: Result | null;
    status: DurableFinishStatus;
  }>(() => ({ key, result: key ? result : null, status: "idle" }));
  if (finish.key !== key) {
    setFinish({ key, result: key ? result : null, status: "idle" });
  }
  const mountedRef = React.useRef(true);
  const activeAttemptRef = React.useRef<{ key: string | null } | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const retry = React.useCallback(() => {
    const captured = finish.result;
    if (
      spectator ||
      activeAttemptRef.current?.key === finish.key ||
      !captured
    )
      return;
    const attempt = { key: finish.key };
    activeAttemptRef.current = attempt;
    setFinish((current) =>
      current.key === finish.key ? { ...current, status: "saving" } : current,
    );
    void Promise.resolve().then(() => onFinished(captured)).then(
      (stored) => {
        if (!mountedRef.current || activeAttemptRef.current !== attempt) return;
        activeAttemptRef.current = null;
        setFinish((current) =>
          current.key === finish.key
            ? { ...current, status: stored ? "stored" : "failed" }
            : current,
        );
      },
      () => {
        if (!mountedRef.current || activeAttemptRef.current !== attempt) return;
        activeAttemptRef.current = null;
        setFinish((current) =>
          current.key === finish.key ? { ...current, status: "failed" } : current,
        );
      },
    );
  }, [finish.key, finish.result, onFinished, spectator]);

  React.useEffect(() => {
    if (!finish.key || spectator || finish.status !== "idle") return undefined;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) retry();
    });
    return () => {
      active = false;
    };
  }, [finish.key, finish.status, retry, spectator]);

  return { status: finish.status, retry };
}

export function DurableFinishPending({
  status,
  spectator,
  onRetry,
}: {
  status: DurableFinishStatus;
  spectator: boolean;
  onRetry: () => void;
}) {
  const failed = status === "failed";
  return (
    <View style={styles.body} accessibilityLiveRegion="polite">
      {!failed ? <ActivityIndicator color={Colors.amber} /> : null}
      <Text style={styles.text} maxFontSizeMultiplier={FontScaleCap.body}>
        {spectator
          ? cs.gameHost.waitingForResult
          : failed
            ? cs.gameHost.resultSaveFailed
            : cs.gameHost.savingResult}
      </Text>
      {failed ? (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.gameHost.retry}
        >
          <Text style={styles.retryText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.gameHost.retry}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  text: { color: Colors.mutedText, fontSize: 15, fontWeight: "600", textAlign: "center" },
  retry: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  retryText: { color: Colors.stout, fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.8 },
});
