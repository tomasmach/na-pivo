/**
 * Nickname picker field — an "@"-prefixed text input with live, debounced
 * availability checking. Used by the profile edit screen and contextual
 * identity prompts.
 *
 * Validation pipeline (mirrors the backend order):
 *   1. Local charset/length/reserved check (instant, no network) — see nickname.ts.
 *   2. If locally valid AND changed from `initialValue`, a ~400ms-debounced
 *      `checkNicknameAvailable` advisory call → neutral/green/amber hint.
 * The parent owns the value (controlled) and is told, via `onStatusChange`,
 * whether the current value is submit-ready (valid + available + non-empty).
 * `updateProfile` remains authoritative — a 409 there overrides any "Volné".
 *
 * When the value equals `initialValue` (edit screen, unchanged nickname) the
 * availability call is skipped and the field reports ready immediately.
 */

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ActivityIndicator, StyleSheet, type TextStyle } from 'react-native';

import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { CheckIcon } from '@/components/shared/IconGlyph';
import { useAccountStore } from '@/stores/accountStore';
import {
  NICKNAME_MAX,
  checkNicknameLocal,
  nicknameReasonMessage,
  nicknameServerReasonMessage,
} from '@/profile/nickname';

const DEBOUNCE_MS = 400;

/** Resolved hint state shown under the input. */
type HintState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'error'; message: string };

/**
 * The synchronous, render-time verdict for the current value (no network). The
 * async availability result is layered on top of this in `hint`.
 */
type LocalVerdict =
  | { kind: 'empty' }
  | { kind: 'unchanged' }
  | { kind: 'invalid'; message: string }
  | { kind: 'needsCheck' };

function localVerdict(value: string, initialValue?: string): LocalVerdict {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  if (initialValue != null && trimmed === initialValue.trim()) return { kind: 'unchanged' };
  const local = checkNicknameLocal(trimmed);
  if (!local.valid) return { kind: 'invalid', message: nicknameReasonMessage(local.reason) };
  return { kind: 'needsCheck' };
}

/**
 * Async availability result. `for` records the exact (trimmed) value the result
 * was computed for, so a result for a previous value is recognised as stale and
 * never shown for a newer one.
 */
type ServerVerdict =
  | { kind: 'available'; for: string }
  | { kind: 'taken'; message: string; for: string }
  // Network/other failure — stay neutral; the authoritative PATCH still runs.
  | { kind: 'inconclusive'; for: string };

interface NicknameFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  /** Pre-filled handle (edit screen). Unchanged value skips the network check. */
  initialValue?: string;
  /** Reports whether the current value is submit-ready (valid + available). */
  onReadyChange?: (ready: boolean) => void;
  autoFocus?: boolean;
}

export const NicknameField = memo(function NicknameField({
  value,
  onChangeText,
  initialValue,
  onReadyChange,
  autoFocus,
}: NicknameFieldProps) {
  const checkNicknameAvailable = useAccountStore((s) => s.checkNicknameAvailable);

  // Synchronous, render-time local verdict — no setState needed.
  const verdict = useMemo(() => localVerdict(value, initialValue), [value, initialValue]);
  // Async availability result, only meaningful when its `for` matches the current
  // value (a result for a previous value is treated as stale in `hint`/`ready`).
  const [server, setServer] = useState<ServerVerdict | null>(null);
  // Guards a stale async result from overwriting a newer keystroke's result.
  const requestSeq = useRef(0);

  // Debounced advisory availability call — the ONLY place state changes, and it
  // happens inside the async timer/promise callbacks (never synchronously in the
  // effect body), so it cannot trigger a cascading render. Each result is tagged
  // with `for: trimmed`, so a previous value's verdict can't be mistaken for the
  // current one's during the new value's debounce window.
  useEffect(() => {
    if (verdict.kind !== 'needsCheck') return;
    const seq = ++requestSeq.current;
    const trimmed = value.trim();
    const timer = setTimeout(() => {
      void checkNicknameAvailable(trimmed).then((result) => {
        if (seq !== requestSeq.current) return; // superseded by a newer keystroke
        if (!result.ok) {
          setServer({ kind: 'inconclusive', for: trimmed });
        } else if (result.available) {
          setServer({ kind: 'available', for: trimmed });
        } else {
          setServer({ kind: 'taken', message: nicknameServerReasonMessage(result.reason), for: trimmed });
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [verdict.kind, value, checkNicknameAvailable]);

  // The async verdict only applies to the value it was computed for. For any
  // newer value (or before the first result) it is stale → treated as null so
  // the field shows "checking" instead of leaking a previous value's verdict.
  const currentServer = server && server.for === value.trim() ? server : null;

  // Derive the visible hint + readiness purely from the two verdicts.
  const hint: HintState = useMemo(() => {
    switch (verdict.kind) {
      case 'empty':
        return { kind: 'idle' };
      case 'unchanged':
        return { kind: 'idle' };
      case 'invalid':
        return { kind: 'error', message: verdict.message };
      case 'needsCheck':
        switch (currentServer?.kind) {
          case 'available':
            return { kind: 'available' };
          case 'taken':
            return { kind: 'error', message: currentServer.message };
          case 'inconclusive':
            return { kind: 'idle' };
          default:
            return { kind: 'checking' };
        }
    }
  }, [verdict, currentServer]);

  const ready =
    verdict.kind === 'unchanged' ||
    (verdict.kind === 'needsCheck' &&
      (currentServer?.kind === 'available' || currentServer?.kind === 'inconclusive'));

  // Notify the parent of submit-readiness (effect → setState is on the parent,
  // and fires only when the boolean actually flips).
  const lastReady = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastReady.current !== ready) {
      lastReady.current = ready;
      onReadyChange?.(ready);
    }
  }, [ready, onReadyChange]);

  return (
    <View style={styles.group}>
      <View style={styles.inputRow}>
        <Text style={styles.at} maxFontSizeMultiplier={FontScaleCap.body}>
          @
        </Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={cs.profile.form.nicknamePlaceholder}
          placeholderTextColor={Colors.mutedText}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          maxLength={NICKNAME_MAX}
          autoFocus={autoFocus}
          accessibilityLabel={cs.a11y.profileNicknameInput}
          maxFontSizeMultiplier={FontScaleCap.body}
        />
        {hint.kind === 'checking' && <ActivityIndicator size="small" color={Colors.amber} />}
        {hint.kind === 'available' && <CheckIcon size={18} color={Colors.success} />}
      </View>
      <NicknameHint hint={hint} />
    </View>
  );
});

function NicknameHint({ hint }: { hint: HintState }) {
  if (hint.kind === 'idle') return null;

  let text: string;
  let style: TextStyle = styles.hintNeutral;
  if (hint.kind === 'checking') {
    text = cs.profile.form.nicknameChecking;
  } else if (hint.kind === 'available') {
    text = cs.profile.form.nicknameAvailable;
    style = styles.hintOk;
  } else {
    text = hint.message;
    style = styles.hintError;
  }

  return (
    <Text style={[styles.hint, style]} maxFontSizeMultiplier={FontScaleCap.body}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    paddingHorizontal: 14,
  },
  at: {
    fontWeight: '700',
    fontSize: 18,
    color: Colors.amber,
  },
  input: {
    flex: 1,
    fontWeight: '500',
    fontSize: 16,
    color: Colors.foam,
    paddingVertical: 12,
  },
  hint: {
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 2,
  },
  hintNeutral: {
    color: Colors.mutedText,
  },
  hintOk: {
    color: Colors.success,
  },
  hintError: {
    color: Colors.amberLight,
  },
});
