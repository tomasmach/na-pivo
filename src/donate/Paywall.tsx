/**
 * Informational "Podpoř autora" sheet.
 *
 * Apple-safe pattern: nothing is purchased or unlocked inside the app. This
 * screen only explains the situation and hands off to Safari, where the
 * actual payment happens via Stripe (donate.stripe.com), entirely outside
 * the App Store.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { cs } from '@/i18n/cs';

function getStripeDonateUrl(): string | null {
  const url = Constants.expoConfig?.extra?.stripeDonateUrl;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleOpenStripe = useCallback(async () => {
    const url = getStripeDonateUrl();
    if (!url) {
      Alert.alert(cs.appName, 'Odkaz pro podporu není zatím k dispozici.');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(cs.appName, 'Nepodařilo se otevřít Safari.');
    }
  }, []);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
      <Text style={styles.eyebrow}>{cs.settings.donate.headerEyebrow}</Text>
      <Text style={styles.title}>{cs.settings.donate.sheetTitle}</Text>

      <View style={styles.divider} />

      <View style={styles.bodyWrap}>
        <Text style={styles.bodyText}>{cs.settings.donate.body1}</Text>
        <Text style={styles.bodyText}>{cs.settings.donate.body2}</Text>
      </View>

      <View style={styles.ctaWrap}>
        <Pressable
          onPress={handleOpenStripe}
          accessibilityRole="link"
          accessibilityLabel={cs.settings.donate.openCta}
          style={({ pressed }) => [
            styles.primaryButton,
            amberGlow(18),
            pressed && styles.primaryButtonPressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {cs.settings.donate.openCta}
          </Text>
        </Pressable>
        <Text style={styles.safariNote}>{cs.settings.donate.safariNote}</Text>
      </View>

      <Pressable
        onPress={handleClose}
        style={styles.closeButton}
        accessibilityRole="button"
        accessibilityLabel={cs.settings.donate.cancel}
        hitSlop={12}
      >
        <Text style={styles.closeText}>{cs.settings.donate.cancel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.stout2,
    paddingHorizontal: 24,
    paddingTop: 28,
    alignItems: 'center',
  },
  eyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.amber,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 32,
    color: Colors.foam,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  divider: {
    width: 48,
    height: 2,
    backgroundColor: Colors.border,
    borderRadius: 1,
    marginVertical: 22,
  },
  bodyWrap: {
    width: '100%',
    gap: 14,
    marginBottom: Spacing.xl,
  },
  bodyText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  ctaWrap: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: Colors.amber,
    borderRadius: Radius.pill,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonPressed: {
    backgroundColor: Colors.amberLight,
    opacity: 0.95,
  },
  primaryButtonText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.stout,
    letterSpacing: -0.3,
  },
  safariNote: {
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    letterSpacing: 0.4,
    color: Colors.mutedText,
    marginTop: 4,
  },
  closeButton: {
    marginTop: 'auto',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  closeText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.mutedText,
  },
});
