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
 * The timeline is a practical trend view, not the narrative Pivní Wrapped.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { t , beerCountLabel, beerNoun, intlLocale } from '@/i18n';
import { deriveReconciledDiaryStats } from '@/data/diarySync';
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
import { useAccountStore } from '@/stores/accountStore';
import { useTallyStore, allSessionsNewestFirst } from '@/stores/tallyStore';
import {
  computeLastPerformance,
  computeLifetime,
  computePeriodStats,
  computeRecords,
  computeTopPubs,
  plausibleFastestBeerMs,
  type LastPerformance,
  type LifetimeStats,
  type PersonalRecords,
  type PubTally,
  type PeriodStat,
} from '@/stats/statsModel';
import { useMyStats } from '@/stats/useMyStats';
import type { PriceCurrency } from '@/utils/currency';

const TONE_LINE: Record<LastPerformance['tone'], string> = {
  start: t.stats.toneStart,
  warmup: t.stats.toneWarmup,
  solid: t.stats.toneSolid,
  big: t.stats.toneBig,
  huge: t.stats.toneHuge,
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
    <View style={styles.heroCard}>
      <View style={styles.heroEyebrowRow}>
        <SparklesIcon size={13} color={Colors.amber} />
        <Text style={styles.heroEyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
          {perf.relation === 'today' ? t.stats.heroToday : t.stats.heroYesterday}
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
              value={t.stats.span(perf.durationMs)}
              caption={t.stats.heroDuration}
            />
            <View style={styles.heroMicroSep} />
            <MicroStat
              icon={<BeerIcon size={16} color={Colors.amber} />}
              value={t.stats.pace(perf.avgGapMs as number)}
              caption={t.stats.heroAvg}
            />
            <View style={styles.heroMicroSep} />
            <MicroStat
              icon={<FlameIcon size={16} color={Colors.amber} />}
              value={t.stats.pace(perf.fastestGapMs as number)}
              caption={t.stats.heroFastest}
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
      ? t.stats.recordMostBeersValue(
          beerCountLabel(records.mostBeersInEvening),
          records.mostBeersPubName,
        )
      : t.stats.recordEmpty;
  const fastest =
    records.fastestBeerMs != null ? t.stats.pace(records.fastestBeerMs) : t.stats.recordEmpty;
  const longest =
    records.longestEveningMs != null ? t.stats.span(records.longestEveningMs) : t.stats.recordEmpty;

  return (
    <View style={styles.card}>
      <RecordRow
        icon={<TrophyIcon size={17} color={Colors.amber} />}
        label={t.stats.recordMostBeers}
        value={mostBeers}
      />
      <View style={styles.rowBorder} />
      <RecordRow
        icon={<FlameIcon size={17} color={Colors.amber} />}
        label={t.stats.recordFastest}
        value={fastest}
      />
      <View style={styles.rowBorder} />
      <RecordRow
        icon={<ClockIcon size={17} color={Colors.amber} />}
        label={t.stats.recordLongest}
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
            {t.stats.totalBeers}
          </Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <StatTile
          icon={<HistoryIcon size={18} color={Colors.amber} />}
          value={String(lifetime.totalEvenings)}
          caption={t.stats.totalEvenings}
        />
        <StatTile
          icon={<MapPinnedIcon size={18} color={Colors.amber} />}
          value={String(lifetime.distinctPubs)}
          caption={t.stats.totalPubs}
        />
        <StatTile
          icon={<CoinsIcon size={18} color={Colors.amber} />}
          value={formatPrice(lifetime.totalSpentCzk, priceCurrency)}
          caption={t.stats.totalSpent}
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

// ─── Months and years ──────────────────────────────────────────────────────

/** Month names come from Intl, so the chart speaks whatever language the app does. */
function monthDate(year: number, month: number): Date {
  return new Date(year, month - 1, 1, 12);
}

function monthShort(year: number, month: number): string {
  return new Intl.DateTimeFormat(intlLocale, { month: 'short' })
    .format(monthDate(year, month))
    .replace('.', '');
}

function monthAndYear(year: number, month: number): string {
  const text = new Intl.DateTimeFormat(intlLocale, { month: 'long', year: 'numeric' }).format(
    monthDate(year, month),
  );
  // Czech writes month names in lower case; the card heading wants a capital.
  return text.charAt(0).toLocaleUpperCase(intlLocale) + text.slice(1);
}

function monthParts(period: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

function recentMonths(periods: PeriodStat[], now: Date, count = 12): PeriodStat[] {
  const byPeriod = new Map(periods.map((period) => [period.period, period]));
  const drinkingNow = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const anchor = new Date(drinkingNow.getFullYear(), drinkingNow.getMonth(), 1, 12);
  const result: PeriodStat[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(anchor.getFullYear(), anchor.getMonth() - offset, 1, 12);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    result.push(
      byPeriod.get(key) ?? {
        period: key,
        beers: 0,
        evenings: 0,
        spentCzk: 0,
        averageBeersPerEvening: 0,
      },
    );
  }
  return result;
}

function PeriodOverview({ months, years, now }: { months: PeriodStat[]; years: PeriodStat[]; now: Date }) {
  const chartMonths = recentMonths(months, now);
  const current = chartMonths[chartMonths.length - 1];
  const currentParts = monthParts(current.period);
  const maxBeers = Math.max(1, ...chartMonths.map((period) => period.beers));
  const visibleYears = [...years].sort((a, b) => b.period.localeCompare(a.period));

  return (
    <View style={styles.periodCard}>
      <View style={styles.periodCurrentRow}>
        <View style={styles.flex}>
          <Text style={styles.periodTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {currentParts ? monthAndYear(currentParts.year, currentParts.month) : current.period}
          </Text>
          <Text style={styles.periodMeta} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.stats.periodEvenings(current.evenings)}
          </Text>
        </View>
        <View style={styles.periodCurrentValueWrap}>
          <Text style={styles.periodCurrentValue} maxFontSizeMultiplier={FontScaleCap.display}>
            {current.beers}
          </Text>
          <Text style={styles.periodCurrentUnit} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.stats.periodBeers}
          </Text>
        </View>
      </View>
      <Text style={styles.periodAverage} maxFontSizeMultiplier={FontScaleCap.body}>
        {t.stats.periodAverage(current.averageBeersPerEvening)}
      </Text>

      <View style={styles.chartDivider} />
      <Text style={styles.chartTitle} maxFontSizeMultiplier={FontScaleCap.body}>
        {t.stats.monthsHeader}
      </Text>
      <View style={styles.monthChart} accessibilityLabel={t.stats.monthsA11y}>
        {chartMonths.map((period) => {
          const parts = monthParts(period.period);
          const height = period.beers === 0 ? 3 : Math.max(8, Math.round((period.beers / maxBeers) * 68));
          return (
            <View
              key={period.period}
              style={styles.monthColumn}
              accessible
              accessibilityLabel={t.stats.monthA11y(period.period, period.beers)}
            >
              <Text style={styles.monthValue} maxFontSizeMultiplier={FontScaleCap.body}>
                {period.beers > 0 ? period.beers : ''}
              </Text>
              <View style={styles.monthBarTrack}>
                <View style={[styles.monthBar, period.beers === 0 && styles.monthBarEmpty, { height }]} />
              </View>
              <Text style={styles.monthLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {parts ? monthShort(parts.year, parts.month) : ''}
              </Text>
            </View>
          );
        })}
      </View>

      {visibleYears.length > 0 && (
        <>
          <View style={styles.chartDivider} />
          <Text style={styles.chartTitle} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.stats.yearsHeader}
          </Text>
          {visibleYears.map((year, index) => (
            <View key={year.period} style={[styles.yearRow, index > 0 && styles.yearRowBorder]}>
              <Text style={styles.yearLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
                {year.period}
              </Text>
              <Text style={styles.yearMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.stats.yearSummary(year.beers, year.averageBeersPerEvening)}
              </Text>
            </View>
          ))}
        </>
      )}
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
  const diarySnapshot = useAccountStore((state) => {
    const snapshot = state.diarySnapshot;
    if (!snapshot || snapshot.accountId !== state.session?.accountId) return null;
    return snapshot.data;
  });

  const sessions = useMemo(() => allSessionsNewestFirst(current, history), [current, history]);
  const last = useMemo(
    () => computeLastPerformance(current, history, now),
    [current, history, now],
  );
  const localLifetime = useMemo(() => computeLifetime(sessions), [sessions]);
  const localRecords = useMemo(() => computeRecords(sessions), [sessions]);
  const localTopPubs = useMemo(() => computeTopPubs(sessions), [sessions]);
  const localPeriods = useMemo(() => computePeriodStats(sessions), [sessions]);
  const reconciled = useMemo(
    () => (diarySnapshot ? deriveReconciledDiaryStats(diarySnapshot, sessions) : null),
    [diarySnapshot, sessions],
  );

  // Prefer durable backend numbers only when they're at least as complete as the
  // local view — so freshly-counted-but-not-yet-synced beers never make the
  // totals appear to shrink.
  const useRemote = remote != null && remote.totalBeers >= localLifetime.totalBeers;

  const lifetime: LifetimeStats = reconciled
    ? {
        totalBeers: reconciled.totalBeers,
        totalEvenings: Math.max(remote?.totalEvenings ?? 0, localLifetime.totalEvenings),
        distinctPubs: Math.max(reconciled.distinctPubs, remote?.distinctPubs ?? 0),
        totalSpentCzk: reconciled.totalSpentCzk,
      }
    : useRemote
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
  const periodMonths: PeriodStat[] =
    useRemote && remote!.periods.months.length > 0 ? remote!.periods.months : localPeriods.months;
  const periodYears: PeriodStat[] =
    useRemote && remote!.periods.years.length > 0 ? remote!.periods.years : localPeriods.years;

  const isEmpty = lifetime.totalBeers === 0 && last == null;

  return (
    <View style={styles.root}>
      {!embedded && (
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.beer.segmentStats}
          </Text>
        </View>
      )}

      {isEmpty ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <TrophyIcon size={52} color={Colors.amber} />
          </View>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.stats.emptyTitle}
          </Text>
          <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.stats.emptyBody}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {last && <PerformanceHero perf={last} priceCurrency={priceCurrency} />}

          <SectionLabel>{t.stats.recordsHeader}</SectionLabel>
          <RecordsCard records={records} />

          <SectionLabel>{t.stats.totalsHeader}</SectionLabel>
          <TotalsCard lifetime={lifetime} priceCurrency={priceCurrency} />

          <SectionLabel>{t.stats.periodsHeader}</SectionLabel>
          <PeriodOverview months={periodMonths} years={periodYears} now={now} />

          {topPubs.length > 0 && (
            <>
              <View style={styles.pubsHeaderRow}>
                <SectionLabel>{t.stats.pubsHeader}</SectionLabel>
                <Text style={styles.pubsSubtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.stats.pubsSubtitle}
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
  headerTitle: { fontWeight: '800', fontSize: 28, color: Colors.foam },

  // — ScrollView —
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs, gap: Spacing.sm },

  // — Section label —
  sectionLabel: {
    fontWeight: '700',
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
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  heroCountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  heroCount: {
    fontWeight: '800',
    fontSize: 64,
    lineHeight: 82,
    paddingTop: 6,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  heroCountNoun: {
    fontWeight: '700',
    fontSize: 22,
    color: Colors.amberLight,
  },
  heroPub: {
    fontWeight: '700',
    fontSize: 17,
    color: Colors.foam,
    marginTop: 2,
  },
  heroTone: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
    marginTop: 4,
  },
  heroDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  heroMicroRow: { flexDirection: 'row', alignItems: 'flex-start' },
  heroMicroSep: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border, marginHorizontal: 4 },
  microStat: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  microValue: {
    fontWeight: '700',
    fontSize: 17,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  microCaption: {
    fontWeight: '700',
    fontSize: 9,
    letterSpacing: 0.8,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  heroSpent: {
    fontWeight: '600',
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
    width: 112,
    flexShrink: 0,
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
  },
  recordValue: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontSize: 15,
    color: Colors.amber,
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
    fontWeight: '800',
    fontSize: 44,
    lineHeight: 56,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  heroStatCaption: {
    fontWeight: '700',
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
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  statCaption: {
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.mutedText,
  },

  // — Monthly and yearly overview —
  periodCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  periodCurrentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  periodTitle: { fontWeight: '700', fontSize: 18, color: Colors.foam },
  periodMeta: { fontWeight: '400', fontSize: 12, color: Colors.mutedText, marginTop: 3 },
  periodCurrentValueWrap: { alignItems: 'flex-end' },
  periodCurrentValue: {
    fontWeight: '800',
    fontSize: 32,
    lineHeight: 38,
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
  },
  periodCurrentUnit: { fontWeight: '700', fontSize: 10, color: Colors.mutedText },
  periodAverage: { fontWeight: '600', fontSize: 13, color: Colors.foamMuted, marginTop: 8 },
  chartDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  chartTitle: { fontWeight: '700', fontSize: 11, color: Colors.mutedText, marginBottom: 10 },
  monthChart: { height: 112, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  monthColumn: { flex: 1, alignItems: 'center', height: 112 },
  monthValue: {
    height: 18,
    fontWeight: '600',
    fontSize: 9,
    color: Colors.foamMuted,
    fontVariant: ['tabular-nums'],
  },
  monthBarTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  monthBar: { width: '100%', backgroundColor: Colors.amber, borderRadius: 3 },
  monthBarEmpty: { backgroundColor: Colors.border },
  monthLabel: { fontWeight: '600', fontSize: 9, color: Colors.mutedText, marginTop: 5 },
  yearRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  yearRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  yearLabel: {
    fontWeight: '700',
    fontSize: 17,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  yearMeta: {
    flex: 1,
    fontWeight: '600',
    fontSize: 12,
    color: Colors.foamMuted,
    textAlign: 'right',
  },

  // — Top pubs —
  pubsHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  pubsSubtitle: {
    fontWeight: '400',
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
    fontWeight: '700',
    fontSize: 12,
    color: Colors.amber,
    fontVariant: ['tabular-nums'],
  },
  pubName: {
    flex: 1,
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
  },
  pubBeers: {
    fontWeight: '700',
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
  emptyIcon: {
    width: 82,
    height: 82,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.35),
    backgroundColor: Colors.stout2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
  },
  emptyBody: {
    fontWeight: '400',
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
  },
});
