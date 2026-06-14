/**
 * Evening detail — the full breakdown of one drinking evening plus the private
 * pub rating. Reached from the "Moje piva" list by the session's `startedAt`
 * (a stable per-session identity). Read-only over tallyStore; the only writable
 * thing here is the personal rating.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { beerCountLabel } from '@/i18n/plural';
import { formatPrice } from '@/utils/currency';
import { ChevronLeftIcon, MapPinIcon } from '@/components/shared/IconGlyph';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore, findSessionByStart, sessionCount, sessionTotalCzk } from '@/stores/tallyStore';
import { sessionBreakdown, eveningDateLabel } from '@/myBeers/eveningModel';
import { EveningBreakdown } from '@/myBeers/EveningBreakdown';
import { PubRatingControl } from '@/myBeers/PubRatingControl';

export default function EveningDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = new Date();

  const params = useLocalSearchParams<{ startedAt?: string }>();
  const startedAt = typeof params.startedAt === 'string' ? params.startedAt : '';

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);

  const session = useMemo(
    () => findSessionByStart(current, history, startedAt),
    [current, history, startedAt],
  );

  const breakdown = useMemo(() => sessionBreakdown(session), [session]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {session ? eveningDateLabel(session.startedAt, now) : cs.myBeers.title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {!session ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.myBeers.emptyTitle}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          {/* Pub + summary */}
          <View style={styles.card}>
            <View style={styles.pubRow}>
              <MapPinIcon size={18} color={Colors.amber} />
              <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
                {session.pubName}
              </Text>
            </View>
            <Text style={styles.summary} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.myBeers.summary(
                beerCountLabel(sessionCount(session)),
                formatPrice(sessionTotalCzk(session), priceCurrency),
              )}
            </Text>
          </View>

          {/* Breakdown */}
          <View style={styles.card}>
            <View style={styles.cardSectionHeader}>
              <Text style={styles.cardSectionHeaderText}>{cs.myBeers.breakdownHeader}</Text>
            </View>
            <EveningBreakdown
              lines={breakdown}
              totalCzk={sessionTotalCzk(session)}
              priceCurrency={priceCurrency}
            />
          </View>

          {/* Rating */}
          <View style={styles.card}>
            <PubRatingControl pubKey={session.pubKey} pubName={session.pubName} />
          </View>

          <View style={{ height: Spacing.lg }} />
        </ScrollView>
      )}
    </SafeAreaView>
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
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  pubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  pubName: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  summary: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
  },
  cardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  cardSectionHeaderText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    textAlign: 'center',
  },
});
