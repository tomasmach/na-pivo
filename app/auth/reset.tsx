/**
 * Password reset screen — route `/auth/reset`, reachable via the deep link
 * `napivo://auth/reset?token=...`.
 *
 * Reads the one-time `token` from the URL, or lets the user paste the code from
 * the e-mail manually. It then takes a new password (>= 8 chars) and calls
 * `resetPassword({ token, password })`. On success we toast and send the user
 * to the tabs; on error we surface `detail`.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';

const MIN_PASSWORD = 8;

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const showToast = useToastStore((s) => s.show);
  const resetPassword = useAccountStore((s) => s.resetPassword);

  const linkToken = useMemo(() => firstParam(params.token).trim(), [params.token]);

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [router]);

  const handleSubmit = useCallback(async () => {
    if (busy) return;
    const token = linkToken || code.trim();
    if (!token) {
      setError(cs.account.errorResetCodeMissing);
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(cs.account.errorPasswordShort);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const result = await resetPassword({ token, password });
      if (result.ok) {
        showToast(cs.account.resetDoneToast);
        router.replace('/(tabs)');
        return;
      }
      setError(result.detail || cs.account.errorGeneric);
    } finally {
      setBusy(false);
    }
  }, [busy, code, linkToken, password, resetPassword, showToast, router]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Pressable
        onPress={leave}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel={cs.a11y.backButton}
        hitSlop={4}
      >
        <ChevronLeftIcon size={22} color={Colors.foam} />
      </Pressable>
      <Text style={styles.headerTitle}>{cs.account.resetTitle}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  return (
    <View style={styles.root}>
      {header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={insets.top + 56}
      >
        <KeyboardAwareScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!linkToken && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{cs.account.resetCodeLabel}</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={(value) => {
                  setCode(value.trim());
                  if (error) setError('');
                }}
                placeholder={cs.account.resetCodePlaceholder}
                placeholderTextColor={Colors.mutedText}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                accessibilityLabel={cs.a11y.authResetCodeInput}
                maxFontSizeMultiplier={FontScaleCap.body}
              />
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{cs.account.resetNewPasswordLabel}</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (error) setError('');
              }}
              placeholder={cs.account.passwordPlaceholder}
              placeholderTextColor={Colors.mutedText}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              accessibilityLabel={cs.a11y.authNewPasswordInput}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
          </View>

          {!!error && (
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {error}
            </Text>
          )}

          <View style={styles.submitButton}>
            <GlowButton
              label={busy ? cs.account.loading : cs.account.resetSubmit}
              onPress={handleSubmit}
              glow={busy ? 'none' : 'soft'}
              accessibilityLabel={cs.account.resetSubmit}
            />
            {busy && (
              <View style={styles.buttonSpinner} pointerEvents="none">
                <ActivityIndicator color={Colors.stout} />
              </View>
            )}
          </View>
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  flex: {
    flex: 1,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },

  // ── Form ──
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  fieldGroup: {
    gap: Spacing.sm,
  },
  label: {
    fontFamily: Fonts.ui.bold,
    fontSize: 12,
    color: Colors.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 52,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    paddingHorizontal: 14,
    fontFamily: Fonts.ui.medium,
    fontSize: 16,
    color: Colors.foam,
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amberLight,
  },
  submitButton: {
    position: 'relative',
    marginTop: Spacing.xs,
  },
  buttonSpinner: {
    position: 'absolute',
    top: 0,
    right: 24,
    bottom: 0,
    justifyContent: 'center',
  },

});
