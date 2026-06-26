import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  ChevronLeftIcon,
  CrownIcon,
  MapPinnedIcon,
  ClipboardListIcon,
  StarIcon,
  ExternalLinkIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export default function BeerTrailPaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.beerTrail.paywallTitle}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.crownWell}>
            <CrownIcon size={34} color={Colors.amber} />
          </View>
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.beerTrail.paywallHeadline}
          </Text>
          <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.beerTrail.paywallBody}
          </Text>
        </View>

        <View style={styles.featureList}>
          <Feature icon={<MapPinnedIcon size={20} color={Colors.amber} />} title={cs.beerTrail.featureMap} />
          <Feature icon={<StarIcon size={20} color={Colors.amber} />} title={cs.beerTrail.featureTrail} />
          <Feature
            icon={<ClipboardListIcon size={20} color={Colors.amber} />}
            title={cs.beerTrail.featureReports}
          />
          <Feature icon={<ExternalLinkIcon size={20} color={Colors.amber} />} title={cs.beerTrail.featureShare} />
        </View>

        <View style={styles.freeCard}>
          <Text style={styles.freeTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.beerTrail.freeStaysTitle}
          </Text>
          <Text style={styles.freeText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.beerTrail.freeStaysBody}
          </Text>
        </View>

        <Pressable
          onPress={() =>
            Alert.alert(cs.beerTrail.purchaseSoonTitle, cs.beerTrail.purchaseSoonBody, [
              { text: cs.common.ok },
              { text: cs.beerTrail.openAccount, onPress: () => router.push('/account' as Href) },
            ])
          }
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.beerTrail.unlock}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Feature({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>{icon}</View>
      <Text style={styles.featureText} maxFontSizeMultiplier={FontScaleCap.body}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
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
    fontSize: 23,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  hero: {
    backgroundColor: Colors.stout3,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  crownWell: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.42),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 34,
    lineHeight: 39,
    color: Colors.foam,
  },
  body: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
  },
  featureList: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 58,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  freeCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    gap: Spacing.xs,
  },
  freeTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 20,
    color: Colors.foam,
  },
  freeText: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.stout,
  },
  pressed: {
    opacity: 0.72,
  },
});
