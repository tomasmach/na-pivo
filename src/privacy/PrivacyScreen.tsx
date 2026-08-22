/**
 * Privacy screen — scrollable, dark background.
 * Shows app privacy policy paragraphs and a mailto contact link.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Linking,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

import { cs } from '@/i18n/cs';

// Same complete policy the auth screen links to (app/auth/index.tsx).
const PRIVACY_POLICY_URL = 'https://tomasmach.github.io/na-pivo/privacy.html';

export default function PrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  function handleEmail() {
    void Linking.openURL(`mailto:${cs.privacy.contactEmail}`);
  }

  // The complete policy lives on the same GitHub Pages site the auth screen
  // links to; this summary is only the short in-app version.
  const handleFullPolicy = () => {
    void Linking.openURL(PRIVACY_POLICY_URL);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top || 16 }]}>
      {/* Header row */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={8}
        >
          <Text style={styles.backChevron}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{cs.privacy.title}</Text>
        {/* Spacer to keep title centered */}
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom + 32, 48) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {cs.privacy.body.map((paragraph, index) => (
          <Text key={index} style={styles.paragraph}>
            {paragraph}
          </Text>
        ))}

        {/* Contact */}
        <View style={styles.contactRow}>
          <Text style={styles.contactLabel}>{cs.privacy.contactLabel}: </Text>
          <Pressable onPress={handleEmail} accessibilityRole="link">
            <Text style={styles.contactEmail}>{cs.privacy.contactEmail}</Text>
          </Pressable>
        </View>

        {/* Complete policy */}
        <Pressable
          onPress={handleFullPolicy}
          style={({ pressed }) => [styles.fullPolicyButton, pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityLabel={cs.privacy.fullPolicyLink}
          hitSlop={8}
        >
          <Text style={styles.fullPolicyText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.privacy.fullPolicyLink}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backChevron: {
    fontWeight: '700',
    fontSize: 32,
    color: Colors.foam,
    lineHeight: 36,
  },
  headerTitle: {
    fontWeight: '800',
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  paragraph: {
    fontWeight: '400',
    fontSize: 15,
    color: Colors.foamMuted,
    lineHeight: 15 * 1.5,
    marginBottom: 16,
  },
  contactRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },
  contactLabel: {
    fontWeight: '400',
    fontSize: 15,
    color: Colors.foamMuted,
  },
  contactEmail: {
    fontWeight: '500',
    fontSize: 15,
    color: Colors.amber,
    textDecorationLine: 'underline',
  },
  fullPolicyButton: {
    marginTop: Spacing.lg,
    minHeight: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  pressed: { opacity: 0.65 },
  fullPolicyText: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.foam,
  },
});
