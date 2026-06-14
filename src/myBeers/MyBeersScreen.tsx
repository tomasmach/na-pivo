/**
 * "Moje piva" — the pivní stopa.
 *
 * A small product surface over the data the counter already collects locally
 * (tallyStore): it turns the running tally + archived sessions into a personal
 * memory of drinking evenings — where you were, what you drank, how many and how
 * much it cost — plus a private "stálo to za návrat?" rating per pub.
 *
 * Read-only over the counter's data (no writes back to the tally), so it can
 * never break the counter. Works fully offline and without an account.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { beerCountLabel } from '@/i18n/plural';
import { formatPrice } from '@/utils/currency';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  BeerIcon,
  HistoryIcon,
} from '@/components/shared/IconGlyph';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  useTallyStore,
  sessionCount,
  sessionTotalCzk,
  type TallySession,
} from '@/stores/tallyStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { sessionBreakdown, eveningDateLabel, eveningDayRelation } from '@/myBeers/eveningModel';
import { EveningBreakdown } from '@/myBeers/EveningBreakdown';
import { PubRatingControl } from '@/myBeers/PubRatingControl';
import { VerdictBadge } from '@/myBeers/VerdictBadge';
import type { PriceCurrency } from '@/utils/currency';

function lastDrinkText(session: TallySession, now: Date): string | null {
  if (eveningDayRelation(session.startedAt, now) !== 'today') return null;
  const latest = session.drinks[session.drinks.length - 1];
  if (!latest) return null;
  const atMs = Date.parse(latest.at);
  if (!Number.isFinite(atMs)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - atMs) / 60000));
  return minutes === 0 ? cs.myBeers.lastDrinkJustNow : cs.myBeers.lastDrinkMinutesAgo(minutes);
}

// ─── Current evening card ──────────────────────────────────────────────────────

function CurrentEveningCard({
  session,
  priceCurrency,
  now,
}: {
  session: TallySession;
  priceCurrency: PriceCurrency;
  now: Date;
}) {
  const count = sessionCount(session);
  const totalCzk = sessionTotalCzk(session);
  const breakdown = useMemo(() => sessionBreakdown(session), [session]);
  const lastText = lastDrinkText(session, now);

  return (
    <View style={styles.card}>
      <View style={styles.cardSectionHeader}>
        <BeerIcon size={14} color={Colors.amber} />
        <Text style={styles.cardSectionHeaderText}>{cs.myBeers.currentHeader}</Text>
        <View style={styles.flex} />
        <Text style={styles.dateLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {eveningDateLabel(session.startedAt, now)}
        </Text>
      </View>

      <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
        {session.pubName}
      </Text>
      <Text style={styles.summary} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.myBeers.summary(beerCountLabel(count), formatPrice(totalCzk, priceCurrency))}
      </Text>
      {lastText && (
        <Text style={styles.lastDrink} maxFontSizeMultiplier={FontScaleCap.body}>
          {lastText}
        </Text>
      )}

      <View style={styles.divider} />
      <EveningBreakdown
        lines={breakdown}
        totalCzk={totalCzk}
        priceCurrency={priceCurrency}
        showTotal={false}
      />

      <View style={styles.divider} />
      <PubRatingControl pubKey={session.pubKey} pubName={session.pubName} />
    </View>
  );
}

// ─── Past evening row ──────────────────────────────────────────────────────────

function PastEveningRow({
  session,
  priceCurrency,
  now,
  onPress,
}: {
  session: TallySession;
  priceCurrency: PriceCurrency;
  now: Date;
  onPress: () => void;
}) {
  const count = sessionCount(session);
  const totalCzk = sessionTotalCzk(session);
  const verdict = usePubRatingsStore((s) => s.ratings[session.pubKey]?.verdict);
  const summary = cs.myBeers.summary(beerCountLabel(count), formatPrice(totalCzk, priceCurrency));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.myBeersEvening(session.pubName, summary)}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowDate} maxFontSizeMultiplier={FontScaleCap.body}>
          {eveningDateLabel(session.startedAt, now)}
        </Text>
        <Text style={styles.rowPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {session.pubName}
        </Text>
        <Text style={styles.rowSummary} maxFontSizeMultiplier={FontScaleCap.body}>
          {summary}
        </Text>
      </View>
      <VerdictBadge verdict={verdict} />
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function MyBeersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Keep the "poslední pivo před X minutami" label honest while the screen is
  // open — tick once a minute, the same pattern the counter uses.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    return () => clearInterval(timer);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);

  const currentEvening = current && current.drinks.length > 0 ? current : null;
  const pastEvenings = history;
  const isEmpty = !currentEvening && pastEvenings.length === 0;

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
        <Text style={styles.headerTitle}>{cs.myBeers.title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isEmpty ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, amberGlow(14)]}>
            <HistoryIcon size={52} color={Colors.amber} />
          </View>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.myBeers.emptyTitle}
          </Text>
          <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.myBeers.emptyBody}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {currentEvening && (
            <CurrentEveningCard
              session={currentEvening}
              priceCurrency={priceCurrency}
              now={now}
            />
          )}

          {pastEvenings.length > 0 && (
            <>
              <Text style={styles.listHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.pastHeader}
              </Text>
              <View style={[styles.card, styles.listCard]}>
                {pastEvenings.map((session, i) => (
                  <View
                    key={`${session.pubKey}|${session.startedAt}`}
                    style={i > 0 && styles.rowBorder}
                  >
                    <PastEveningRow
                      session={session}
                      priceCurrency={priceCurrency}
                      now={now}
                      onPress={() =>
                        router.push({
                          pathname: '/evening',
                          params: { startedAt: session.startedAt },
                        })
                      }
                    />
                  </View>
                ))}
              </View>
            </>
          )}

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
  flex: { flex: 1 },

  // — Header —
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

  // — ScrollView —
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  // — Cards —
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  listCard: {
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  cardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardSectionHeaderText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  dateLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.mutedText,
  },
  pubName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    marginBottom: 4,
  },
  summary: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
  },
  lastDrink: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },

  // — Past list —
  listHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.sm,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 64,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rowPressed: {
    opacity: 0.65,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowDate: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.mutedText,
    textTransform: 'uppercase',
  },
  rowPub: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  rowSummary: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  // — Empty —
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: Spacing.md,
    paddingBottom: 60,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
  },
});
