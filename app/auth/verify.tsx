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
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
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
  const [state, setState] = useState<VerifyState>(token ? 'loading' : 'invalid');
  // Guard against React 18 double-invoke / re-renders firing the call twice.
  const ranRef = useRef(false);

  useEffect(() => {
    if (!token || ranRef.current) return;
    ranRef.current = true;
    let active = true;
    void verifyEmail(token).then((result) => {
      if (!active) return;
      setState(result.ok ? 'success' : 'error');
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
              {cs.account.verifyLoading}
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>
              {state === 'success' ? cs.account.verifySuccessTitle : cs.account.verifyErrorTitle}
            </Text>
            <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
              {state === 'success'
                ? cs.account.verifySuccessBody
                : state === 'invalid'
                  ? cs.account.verifyInvalidBody
                  : cs.account.verifyErrorBody}
            </Text>
            <View style={styles.button}>
              <GlowButton
                label={cs.account.verifyDoneCta}
                onPress={leave}
                accessibilityLabel={cs.account.verifyDoneCta}
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
    fontFamily: Fonts.display.extrabold,
    fontSize: 34,
    lineHeight: 42,
    color: Colors.foam,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.ui.regular,
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
