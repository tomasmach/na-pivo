/**
 * "Výkon" — the personal beer-stats surface (third segment of the "Štamgast"
 * tab). The morning-after glance: how was last night, your personal records,
 * lifetime totals, and which pubs you've drunk the most in.
 *
 * Read-only over the counter's data (tallyStore) so it can never break counting,
 * and fully functional offline / without an account. When an account holder's
 * durable backend stats are available (useMyStats), the lifetime / records /
 * per-pub sections prefer those — they outlive the 50-session local cap and a
 * reinstall — while the "last performance" hero always stays local (its timing
 * detail lives only on the device).
 *
 * Deliberately restrained: no yearly/monthly recap here. That's Pivní Wrapped.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { beerCountLabel, beerNoun } from '@/i18n/plural';
import { formatPrice } from '@/utils/currency';
import {
  BeerIcon,
  TrophyIcon,
  FlameIcon,
  ClockIcon,
  HistoryIcon,
  MapPinnedIcon,
  MapPinIcon,
  CoinsIcon,
  SparklesIcon,
} from '@/components/shared/IconGlyph';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore, allSessionsNewestFirst } from '@/stores/tallyStore';
import {
  computeLastPerformance,
  computeLifetime,
  computeRecords,
  computeTopPubs,
  plausibleFastestBeerMs,
  type LastPerformance,
  type LifetimeStats,
  type PersonalRecords,
  type PubTally,
} from '@/stats/statsModel';
import { useMyStats } from '@/stats/useMyStats';
import type { PriceCurrency } from '@/utils/currency';

const TONE_LINE: Record<LastPerformance['tone'], string> = {
  start: cs.stats.toneStart,
  warmup: cs.stats.toneWarmup,
  solid: cs.stats.toneSolid,
  big: cs.stats.toneBig,
  huge: cs.stats.toneHuge,
};

// ─── Section header ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
      {children}
    </Text>
  );
}

// ─── Hero: last performance ─────────────────────────────────────────────────

function PerformanceHero({
  perf,
  priceCurrency,
}: {
  perf: LastPerformance;
  priceCurrency: PriceCurrency;
}) {
  const showPace = perf.avgGapMs != null && perf.fastestGapMs != null;

  return (
    <View style={[styles.heroCard, amberGlow(12)]}>
      <View style={styles.heroEyebrowRow}>
        <SparklesIcon size={13} color={Colors.amber} />
        <Text style={styles.heroEyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
          {perf.relation === 'today' ? cs.stats.heroToday : cs.stats.heroYesterday}
        </Text>
      </View>

      <View style={styles.heroCountRow}>
        <Text
          style={styles.heroCount}
          numberOfLines={1}
          adjustsFontSizeToFit
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {perf.beers}
        </Text>
        <Text style={styles.heroCountNoun} maxFontSizeMultiplier={FontScaleCap.heading}>
          {beerNoun(perf.beers)}
        </Text>
      </View>

      <Text style={styles.heroPub} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
        {perf.pubName}
      </Text>
      <Text style={styles.heroTone} maxFontSizeMultiplier={FontScaleCap.body}>
        {TONE_LINE[perf.tone]}
      </Text>

      {showPace && (
        <>
          <View style={styles.heroDivider} />
          <View style={styles.heroMicroRow}>
            <MicroStat
              icon={<ClockIcon size={16} color={Colors.amber} />}
              value={cs.stats.span(perf.durationMs)}
              caption={cs.stats.heroDuration}
            />
            <View style={styles.heroMicroSep} />
            <MicroStat
              icon={<BeerIcon size={16} color={Colors.amber} />}
              value={cs.stats.pace(perf.avgGapMs as number)}
              caption={cs.stats.heroAvg}
            />
            <View style={styles.heroMicroSep} />
            <MicroStat
              icon={<FlameIcon size={16} color={Colors.amber} />}
              value={cs.stats.pace(perf.fastestGapMs as number)}
              caption={cs.stats.heroFastest}
            />
          </View>
        </>
      )}
      <Text style={styles.heroSpent} maxFontSizeMultiplier={FontScaleCap.body}>
        {formatPrice(perf.spentCzk, priceCurrency)}
      </Text>
    </View>
  );
}

function MicroStat({
  icon,
  value,
  caption,
}: {
  icon: React.ReactNode;
  value: string;
  caption: string;
}) {
  return (
    <View style={styles.microStat}>
      {icon}
      <Text style={styles.microValue} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
        {value}
      </Text>
      <Text style={styles.microCaption} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {caption}
      </Text>
    </View>
  );
}

// ─── Records ────────────────────────────────────────────────────────────────

function RecordRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.recordRow}>
      <View style={styles.recordIconWell}>{icon}</View>
      <Text style={styles.recordLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
      <Text style={styles.recordValue} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
        {value}
      </Text>
    </View>
  );
}

function RecordsCard({ records }: { records: PersonalRecords }) {
  const mostBeers =
    records.mostBeersInEvening > 0
      ? cs.stats.recordMostBeersValue(
          beerCountLabel(records.mostBeersInEvening),
          records.mostBeersPubName,
        )
      : cs.stats.recordEmpty;
  const fastest =
    records.fastestBeerMs != null ? cs.stats.pace(records.fastestBeerMs) : cs.stats.recordEmpty;
  const longest =
    records.longestEveningMs != null ? cs.stats.span(records.longestEveningMs) : cs.stats.recordEmpty;

  return (
    <View style={styles.card}>
      <RecordRow
        icon={<TrophyIcon size={17} color={Colors.amber} />}
        label={cs.stats.recordMostBeers}
        value={mostBeers}
      />
      <View style={styles.rowBorder} />
      <RecordRow
        icon={<FlameIcon size={17} color={Colors.amber} />}
        label={cs.stats.recordFastest}
        value={fastest}
      />
      <View style={styles.rowBorder} />
      <RecordRow
        icon={<ClockIcon size={17} color={Colors.amber} />}
        label={cs.stats.recordLongest}
        value={longest}
      />
    </View>
  );
}

// ─── Lifetime totals ────────────────────────────────────────────────────────

function TotalsCard({
  lifetime,
  priceCurrency,
}: {
  lifetime: LifetimeStats;
  priceCurrency: PriceCurrency;
}) {
  return (
    <View style={styles.totalsWrap}>
      <View style={[styles.heroStat]}>
        <View style={styles.heroStatIcon}>
          <BeerIcon size={26} color={Colors.amber} />
        </View>
        <View style={styles.flex}>
          <Text
            style={styles.heroStatValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {lifetime.totalBeers}
          </Text>
          <Text style={styles.heroStatCaption} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.stats.totalBeers}
          </Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <StatTile
          icon={<HistoryIcon size={18} color={Colors.amber} />}
          value={String(lifetime.totalEvenings)}
          caption={cs.stats.totalEvenings}
        />
        <StatTile
          icon={<MapPinnedIcon size={18} color={Colors.amber} />}
          value={String(lifetime.distinctPubs)}
          caption={cs.stats.totalPubs}
        />
        <StatTile
          icon={<CoinsIcon size={18} color={Colors.amber} />}
          value={formatPrice(lifetime.totalSpentCzk, priceCurrency)}
          caption={cs.stats.totalSpent}
        />
      </View>
    </View>
  );
}

function StatTile({
  icon,
  value,
  caption,
}: {
  icon: React.ReactNode;
  value: string;
  caption: string;
}) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statIconWell}>{icon}</View>
      <Text
        style={styles.statValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={FontScaleCap.display}
      >
        {value}
      </Text>
      <Text style={styles.statCaption} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {caption}
      </Text>
    </View>
  );
}

// ─── Top pubs ───────────────────────────────────────────────────────────────

function TopPubsCard({ pubs }: { pubs: PubTally[] }) {
  return (
    <View style={[styles.card, styles.listCard]}>
      {pubs.map((pub, i) => (
        <View key={pub.pubKey} style={i > 0 && styles.rowBorder}>
          <View style={styles.pubRow}>
            <View style={styles.pubRank}>
              <Text style={styles.pubRankText} maxFontSizeMultiplier={FontScaleCap.body}>
                {i + 1}
              </Text>
            </View>
            <MapPinIcon size={15} color={Colors.mutedText} />
            <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
              {pub.pubName}
            </Text>
            <Text style={styles.pubBeers} maxFontSizeMultiplier={FontScaleCap.body}>
              {beerCountLabel(pub.beers)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function StatsScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const insets = useSafeAreaInsets();

  // Keep the "today / yesterday" hero relation honest while open.
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
  const remote = useMyStats();

  const sessions = useMemo(() => allSessionsNewestFirst(current, history), [current, history]);
  const last = useMemo(
    () => computeLastPerformance(current, history, now),
    [current, history, now],
  );
  const localLifetime = useMemo(() => computeLifetime(sessions), [sessions]);
  const localRecords = useMemo(() => computeRecords(sessions), [sessions]);
  const localTopPubs = useMemo(() => computeTopPubs(sessions), [sessions]);

  // Prefer durable backend numbers only when they're at least as complete as the
  // local view — so freshly-counted-but-not-yet-synced beers never make the
  // totals appear to shrink.
  const useRemote = remote != null && remote.totalBeers >= localLifetime.totalBeers;

  const lifetime: LifetimeStats = useRemote
    ? {
        totalBeers: remote!.totalBeers,
        totalEvenings: remote!.totalEvenings,
        distinctPubs: remote!.distinctPubs,
        totalSpentCzk: remote!.totalSpentCzk,
      }
    : localLifetime;

  const records: PersonalRecords = useRemote
    ? {
        mostBeersInEvening: remote!.records.mostBeersInEvening,
        mostBeersPubName: remote!.records.mostBeersPubName,
        mostBeersStartedAt: null,
        fastestBeerMs:
          remote!.records.fastestBeerSeconds != null
            ? plausibleFastestBeerMs(remote!.records.fastestBeerSeconds * 1000)
            : null,
        longestEveningMs:
          remote!.records.longestEveningSeconds != null
            ? remote!.records.longestEveningSeconds * 1000
            : null,
      }
    : localRecords;

  const topPubs: PubTally[] =
    useRemote && remote!.topPubs.length > 0
      ? remote!.topPubs.map((p) => ({
          pubKey: p.cacheKey,
          pubName: p.name,
          beers: p.beers,
          spentCzk: p.spentCzk,
          lastAt: p.lastDrankAt,
        }))
      : localTopPubs;

  const isEmpty = lifetime.totalBeers === 0 && last == null;

  return (
    <View style={styles.root}>
      {!embedded && (
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.beer.segmentStats}
          </Text>
        </View>
      )}

      {isEmpty ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, amberGlow(14)]}>
            <TrophyIcon size={52} color={Colors.amber} />
          </View>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.stats.emptyTitle}
          </Text>
          <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.stats.emptyBody}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {last && <PerformanceHero perf={last} priceCurrency={priceCurrency} />}

          <SectionLabel>{cs.stats.recordsHeader}</SectionLabel>
          <RecordsCard records={records} />

          <SectionLabel>{cs.stats.totalsHeader}</SectionLabel>
          <TotalsCard lifetime={lifetime} priceCurrency={priceCurrency} />

          {topPubs.length > 0 && (
            <>
              <View style={styles.pubsHeaderRow}>
                <SectionLabel>{cs.stats.pubsHeader}</SectionLabel>
                <Text style={styles.pubsSubtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.stats.pubsSubtitle}
                </Text>
              </View>
              <TopPubsCard pubs={topPubs} />
            </>
          )}

          <View style={{ height: Spacing.lg }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  flex: { flex: 1 },

  // — Header (non-embedded only) —
  header: { paddingBottom: 12, paddingHorizontal: Spacing.lg },
  headerTitle: { fontFamily: Fonts.display.extrabold, fontSize: 28, color: Colors.foam },

  // — ScrollView —
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, gap: Spacing.sm },

  // — Section label —
  sectionLabel: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.md,
    marginLeft: 4,
  },

  // — Shared card —
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 6,
  },
  listCard: { paddingVertical: 2, paddingHorizontal: 0 },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },

  // — Hero card —
  heroCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    padding: Spacing.lg,
    marginTop: Spacing.xs,
  },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroEyebrow: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  heroCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  heroCount: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 64,
    lineHeight: 70,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  heroCountNoun: {
    fontFamily: Fonts.display.bold,
    fontSize: 22,
    color: Colors.amberLight,
  },
  heroPub: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.foam,
    marginTop: 2,
  },
  heroTone: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
    marginTop: 4,
  },
  heroDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  heroMicroRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroMicroSep: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border, marginHorizontal: 4 },
  microStat: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  microValue: {
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  microCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 9,
    letterSpacing: 0.8,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  heroSpent: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: Spacing.md,
    textAlign: 'right',
  },

  // — Records —
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 56,
  },
  recordIconWell: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordLabel: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  recordValue: {
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    color: Colors.amber,
    flexShrink: 1,
    textAlign: 'right',
  },

  // — Lifetime totals —
  totalsWrap: { gap: Spacing.sm },
  heroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  heroStatIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStatValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 44,
    lineHeight: 56,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  heroStatCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.2,
    color: Colors.mutedText,
    marginTop: 2,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statTile: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: 6,
  },
  statIconWell: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  statCaption: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.mutedText,
  },

  // — Top pubs —
  pubsHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  pubsSubtitle: {
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    marginRight: 4,
  },
  pubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    minHeight: 52,
  },
  pubRank: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pubRankText: {
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
  },
  pubName: {
    flex: 1,
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  pubBeers: {
    fontFamily: Fonts.ui.bold,
    fontSize: 13,
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
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
  emptyIcon: { marginBottom: 4 },
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
