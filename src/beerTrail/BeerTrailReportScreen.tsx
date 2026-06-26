import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { fetchBeerTrailSnapshot, type BeerTrailReport, type BeerTrailSnapshot } from '@/beerTrail/beerTrailClient';
import {
  BeerIcon,
  ChevronLeftIcon,
  ClipboardListIcon,
  CrownIcon,
  ExternalLinkIcon,
  MapPinnedIcon,
  StarIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { formatPrice } from '@/utils/currency';
import { useSettingsStore } from '@/stores/settingsStore';

export default function BeerTrailReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const [periodAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [snapshot, setSnapshot] = useState<BeerTrailSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBeerTrailSnapshot({
      period,
      year: periodAnchor.year,
      month: periodAnchor.month,
      signal: controller.signal,
    }).then((next) => {
      setSnapshot(next);
      setLoaded(true);
    });
    return () => controller.abort();
  }, [period, periodAnchor]);

  const report = snapshot?.report;
  const handleShare = useCallback(() => {
    if (!report) return;
    const message = [report.share.title, ...report.share.lines].filter(Boolean).join('\n');
    void Share.share({ message });
  }, [report]);

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
          {cs.beerTrail.reportTitle}
        </Text>
        <Pressable
          onPress={() => router.push('/beer-trail' as Href)}
          style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.beerTrail.openMap}
          hitSlop={4}
        >
          <MapPinnedIcon size={20} color={Colors.amber} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? (
          <StateCard text={cs.beerTrail.loading} />
        ) : !snapshot ? (
          <StateCard text={cs.beerTrail.loadFailed} />
        ) : snapshot.locked ? (
          <LockedCard onPress={() => router.push('/beer-trail-plus' as Href)} />
        ) : report ? (
          <>
            <View style={styles.segment}>
              <SegmentButton
                active={period === 'month'}
                label={cs.beerTrail.periodMonth}
                onPress={() => {
                  if (period === 'month') return;
                  setLoaded(false);
                  setPeriod('month');
                }}
              />
              <SegmentButton
                active={period === 'year'}
                label={cs.beerTrail.periodYear}
                onPress={() => {
                  if (period === 'year') return;
                  setLoaded(false);
                  setPeriod('year');
                }}
              />
            </View>

            <ReportHero report={report} />

            <View style={styles.statsGrid}>
              <ReportStat icon={<MapPinnedIcon size={18} color={Colors.amber} />} value={String(report.pubsCount)} label={cs.beerTrail.statPubs} />
              <ReportStat icon={<StarIcon size={18} color={Colors.amber} />} value={String(report.citiesCount)} label={cs.beerTrail.statCities} />
              <ReportStat icon={<BeerIcon size={18} color={Colors.amber} />} value={String(report.totalBeers)} label={cs.beerTrail.statBeers} />
              <ReportStat
                icon={<ClipboardListIcon size={18} color={Colors.amber} />}
                value={report.averagePriceCzk == null ? cs.profile.notAvailable : formatPrice(report.averagePriceCzk, priceCurrency)}
                label={cs.beerTrail.statAverage}
              />
            </View>

            <View style={styles.detailCard}>
              <DetailLine label={cs.beerTrail.topPub} value={report.topPub?.name ?? cs.profile.notAvailable} />
              <DetailLine label={cs.beerTrail.topBeer} value={report.topBeer?.name ?? cs.profile.notAvailable} />
              <DetailLine label={cs.beerTrail.discovery} value={report.discovery?.name ?? cs.profile.notAvailable} />
              <DetailLine
                label={cs.beerTrail.priceRange}
                value={
                  report.minPriceCzk == null || report.maxPriceCzk == null
                    ? cs.profile.notAvailable
                    : `${formatPrice(report.minPriceCzk, priceCurrency)} – ${formatPrice(report.maxPriceCzk, priceCurrency)}`
                }
              />
            </View>

            <Pressable
              onPress={handleShare}
              style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.beerTrailShare}
            >
              <ExternalLinkIcon size={18} color={Colors.stout} />
              <Text style={styles.shareText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.beerTrail.shareReport}
              </Text>
            </Pressable>
          </>
        ) : (
          <StateCard text={cs.beerTrail.noReportYet} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SegmentButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segmentButton, active && styles.segmentButtonActive]}>
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ReportHero({ report }: { report: BeerTrailReport }) {
  return (
    <View style={styles.heroCard}>
      <View style={styles.heroTop}>
        <View style={styles.heroIcon}>
          <ClipboardListIcon size={24} color={Colors.amber} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
            {report.kind === 'year' ? cs.beerTrail.periodYear : cs.beerTrail.periodMonth}
          </Text>
          <Text style={styles.heroTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {report.kind === 'year'
              ? cs.beerTrail.reportHeadingYear(report.year)
              : cs.beerTrail.reportHeadingMonth(report.month ?? 0, report.year)}
          </Text>
        </View>
      </View>
      <Text style={styles.verdict} maxFontSizeMultiplier={FontScaleCap.heading}>
        {report.verdict}
      </Text>
    </View>
  );
}

function ReportStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FontScaleCap.display}>
        {value}
      </Text>
      <Text style={styles.statLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
      <Text style={styles.detailValue} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {value}
      </Text>
    </View>
  );
}

function StateCard({ text }: { text: string }) {
  return (
    <View style={styles.stateCard}>
      <ClipboardListIcon size={24} color={Colors.amber} />
      <Text style={styles.stateText}>{text}</Text>
    </View>
  );
}

function LockedCard({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.lockedCard}>
      <CrownIcon size={28} color={Colors.amber} />
      <Text style={styles.lockedTitle}>{cs.beerTrail.lockedTitle}</Text>
      <Text style={styles.lockedBody}>{cs.beerTrail.lockedBody}</Text>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.lockedButton, pressed && styles.pressed]}>
        <Text style={styles.lockedButtonText}>{cs.beerTrail.unlock}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.stout },
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
  headerAction: {
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
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: Colors.amber,
  },
  segmentText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    color: Colors.mutedText,
  },
  segmentTextActive: {
    color: Colors.stout,
  },
  heroCard: {
    backgroundColor: Colors.stout3,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    padding: 18,
    gap: Spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: Colors.amber,
  },
  heroTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 25,
    color: Colors.foam,
  },
  verdict: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: Colors.foam,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  statTile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: 6,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: withAlpha(Colors.amber, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 29,
    color: Colors.foam,
  },
  statLabel: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 0.9,
    color: Colors.mutedText,
  },
  detailCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  detailLine: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  detailLabel: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1.1,
    color: Colors.amber,
  },
  detailValue: {
    marginTop: 3,
    fontFamily: Fonts.display.bold,
    fontSize: 18,
    color: Colors.foam,
  },
  shareButton: {
    minHeight: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 15,
    color: Colors.stout,
  },
  stateCard: {
    minHeight: 150,
    borderRadius: Radius.cardLarge,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: 20,
  },
  stateText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  lockedCard: {
    borderRadius: Radius.cardLarge,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  lockedTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
  },
  lockedBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  lockedButton: {
    minHeight: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedButtonText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.stout,
  },
  pressed: {
    opacity: 0.72,
  },
});
