/**
 * Email verification handler — route `/auth/verify`, opened via the deep link
 * `napivo://auth/verify?token=...`.
 *
 * On mount it reads `token` and calls `verifyEmail(token)` exactly once,
 * showing a spinner while in flight and then a success or error state. This may
 * open from a cold start (the app was launched by tapping the e-mail link), so
 * it must stand alone without relying on prior navigation.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { t } from '@/i18n';
import { GlowButton } from '@/components/shared/GlowButton';
import { useAccountStore } from '@/stores/accountStore';

type VerifyState = 'loading' | 'success' | 'error' | 'invalid';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function VerifyEmailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const verifyEmail = useAccountStore((s) => s.verifyEmail);

  const token = firstParam(params.token).trim();
  const [verification, setVerification] = useState<{
    token: string;
    state: Exclude<VerifyState, 'invalid'>;
  } | null>(token ? { token, state: 'loading' } : null);
  const state: VerifyState = !token
    ? 'invalid'
    : verification?.token === token
      ? verification.state
      : 'loading';
  // Reuse one request per active token. A restarted effect can subscribe to
  // the same promise, while a different deep link starts a fresh request.
  const verificationRequestRef = useRef<{
    token: string;
    promise: ReturnType<typeof verifyEmail>;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      verificationRequestRef.current = null;
      return;
    }
    if (verificationRequestRef.current?.token !== token) {
      verificationRequestRef.current = {
        token,
        promise: verifyEmail(token),
      };
    }
    const request = verificationRequestRef.current.promise;
    let active = true;
    void request
      .then((result) => {
        if (!active) return;
        setVerification({ token, state: result.ok ? 'success' : 'error' });
      })
      .catch(() => {
        if (active) setVerification({ token, state: 'error' });
      });
    return () => {
      active = false;
    };
  }, [token, verifyEmail]);

  const leave = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)' as Href);
    }
  };

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + Spacing.xl, paddingBottom: Math.max(insets.bottom + 24, 32) },
      ]}
    >
      <View style={styles.content}>
        {state === 'loading' ? (
          <>
            <ActivityIndicator size="large" color={Colors.amber} />
            <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.account.verifyLoading}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {state === 'success' ? t.account.verifySuccessTitle : t.account.verifyErrorTitle}
            </Text>
            <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
              {state === 'success'
                ? t.account.verifySuccessBody
                : state === 'invalid'
                  ? t.account.verifyInvalidBody
                  : t.account.verifyErrorBody}
            </Text>
            <View style={styles.button}>
              <GlowButton
                label={t.account.verifyDoneCta}
                onPress={leave}
                accessibilityLabel={t.account.verifyDoneCta}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: Spacing.lg,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  title: {
    fontWeight: '800',
    fontSize: 34,
    lineHeight: 42,
    color: Colors.foam,
    textAlign: 'center',
  },
  body: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
  button: {
    alignSelf: 'stretch',
    marginTop: Spacing.sm,
  },
});
