/**
 * "Deník" — the second half of the Štamgast tab, and the merger of what used to
 * be two separate segments ("Výkon" and "Historie").
 *
 * They were the same screen wearing two hats: both opened on the last evening,
 * both listed what came before, both differed only in which button sat at the
 * bottom. So the tab now has two segments instead of three, and this one is
 * four blocks and nothing else:
 *
 *   1. the last night as one card — big amber numeral, a drawn beer mat with
 *      tally marks, and a footer with the place and the money,
 *   2. every older night under it as one quiet chronology,
 *   3. one nudge slot, fixed height, at most one message,
 *   4. ONE amber button: "Dopiš večer".
 *
 * Every lifetime number — records, totals, months, years, top pubs — lives one
 * tap deep in the "Kolik jich už bylo?" sheet behind the "…" button. Rating a
 * pub and mapping it are gone from this surface on purpose: both already exist
 * in the evening detail (`EveningDetailScreen`), and two paths to one thing was
 * the single worst habit of the old screens.
 *
 * Read-only over the counter's data (tallyStore) exactly like its predecessors,
 * so it can never break counting, and it works offline and without an account.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { beerCountLabel, beerNoun, czechPlural } from '@/i18n/plural';
import { formatPrice } from '@/utils/currency';
import { ChevronRightIcon, MenuIcon } from '@/components/shared/IconGlyph';

import { NightCard } from '@/diary/NightCard';
import { TallyCoaster } from '@/diary/TallyCoaster';
import { DiaryStatsSheet, type StatRow } from '@/diary/DiaryStatsSheet';

import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { GlowButton } from '@/components/shared/GlowButton';
import { ScrollFade } from '@/components/shared/ScrollFade';

import { fetchMyBeerCheckIns, type BeerCheckIn, type BeerCheckInInput } from '@/data/beerCheckinsClient';
import { getPendingBeerCheckIns } from '@/data/beerCheckinsQueue';
import { deriveReconciledDiaryStats } from '@/data/diarySync';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import {
  useTallyStore,
  allSessionsNewestFirst,
  sessionTotalCzk,
  type TallySession,
} from '@/stores/tallyStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import {
  eveningDateLabel,
  eveningDayRelation,
  sessionDrinkSummary,
} from '@/myBeers/eveningModel';
import { VerdictBadge } from '@/myBeers/VerdictBadge';
import { HistoricalBeerEntrySheet } from '@/myBeers/HistoricalBeerEntrySheet';
import {
  computeLifetime,
  computePeriodStats,
  computeRecords,
  computeTopPubs,
  plausibleFastestBeerMs,
  type LifetimeStats,
  type PeriodStat,
  type PersonalRecords,
  type PubTally,
} from '@/stats/statsModel';
import { useMyStats } from '@/stats/useMyStats';
import { normalizeDrinkType } from '@/drinks/drinkTypes';
import type { PriceCurrency } from '@/utils/currency';

/** "4,2 km" — the walked-distance figure inherited from the profile's old grid. */
function formatWalkedKm(metres: number): string {
  const km = metres / 1000;
  const text = km
    .toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
    .replace(/ /g, ' ');
  return `${text} ${cs.profile.kmShort}`;
}

/** Beers only — the count that gets the big numeral, exactly as on the counter. */
function beerCount(session: TallySession): number {
  return session.drinks.filter((d) => normalizeDrinkType(d.drinkType) === 'beer').length;
}

/** Declensions for the nights that held no beer at all. */
const OTHER_NOUN: Record<'wine' | 'soft_drink' | 'shot', Parameters<typeof czechPlural>[1]> = {
  wine: { one: 'víno', few: 'vína', many: 'vín' },
  soft_drink: { one: 'nealko', few: 'nealka', many: 'nealk' },
  shot: { one: 'panák', few: 'panáky', many: 'panáků' },
};

/**
 * The noun under the numeral. Beers win; a night of nothing but shots or wine
 * still gets an honest label instead of claiming "0 PIV".
 */
function nightNoun(session: TallySession): { count: number; noun: string } {
  const beers = beerCount(session);
  if (beers > 0) return { count: beers, noun: beerNoun(beers).toUpperCase() };

  const total = session.drinks.length;
  if (total === 0) return { count: 0, noun: cs.diary.emptyNoun };

  // Whatever there was most of that night names the numeral.
  const tally = new Map<string, number>();
  for (const drink of session.drinks) {
    const type = normalizeDrinkType(drink.drinkType);
    tally.set(type, (tally.get(type) ?? 0) + 1);
  }
  let dominant: 'wine' | 'soft_drink' | 'shot' = 'shot';
  let best = -1;
  for (const [type, count] of tally) {
    if (count > best && type in OTHER_NOUN) {
      best = count;
      dominant = type as 'wine' | 'soft_drink' | 'shot';
    }
  }
  return { count: total, noun: czechPlural(total, OTHER_NOUN[dominant]).toUpperCase() };
}

// ─── One older night ──────────────────────────────────────────────────────────

function NightRow({
  session,
  priceCurrency,
  now,
  isFirst,
  onPress,
}: {
  session: TallySession;
  priceCurrency: PriceCurrency;
  now: Date;
  isFirst: boolean;
  onPress: () => void;
}) {
  const verdict = usePubRatingsStore((s) => s.ratings[session.pubKey]?.verdict);
  const totalCzk = sessionTotalCzk(session);
  const meta = cs.diary.nightMeta([
    eveningDateLabel(session.startedAt, now),
    sessionDrinkSummary(session),
    totalCzk > 0 ? formatPrice(totalCzk, priceCurrency) : '',
  ]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, !isFirst && styles.rowDivider, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.diaryNight(session.pubName, meta)}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {session.pubName}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {meta}
        </Text>
      </View>
      <VerdictBadge verdict={verdict} />
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export interface DiaryScreenProps {
  embedded?: boolean;
  /** Set by the host (BeerScreen) when the "…" door sits in its header row
   *  instead of ours; leaving it undefined keeps the screen self-contained. */
  statsOpen?: boolean;
  onStatsClose?: () => void;
}

export default function DiaryScreen({
  embedded = false,
  statsOpen: statsOpenProp,
  onStatsClose,
}: DiaryScreenProps = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Keep the relative date labels honest while the screen is open — the same
  // one-minute tick both predecessors used.
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
  // Inherited from the profile's stats grid, which the rebuild removed.
  const ratingsCount = usePubRatingsStore((s) => Object.keys(s.ratings).length);
  const walkedM = useAccountStore((s) => s.profile?.usage?.walkedDistanceM ?? null);
  const diarySnapshot = useAccountStore((state) => {
    const snapshot = state.diarySnapshot;
    if (!snapshot || snapshot.accountId !== state.session?.accountId) return null;
    return snapshot.data;
  });

  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [ownStatsOpen, setOwnStatsOpen] = useState(false);
  const statsControlled = statsOpenProp !== undefined;
  const statsVisible = statsControlled ? statsOpenProp : ownStatsOpen;
  const closeStats = useCallback(() => {
    if (statsControlled) onStatsClose?.();
    else setOwnStatsOpen(false);
  }, [statsControlled, onStatsClose]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [diaryToken, setDiaryToken] = useState(0);

  // The diary fetch only feeds the "waiting to send" nudge and the failure
  // strip; the trail itself is local, so nothing here blocks the screen.
  useEffect(() => {
    const controller = new AbortController();
    void getPendingBeerCheckIns().then((pending) => {
      if (!controller.signal.aborted) setPendingCount(pending.length);
    });
    void fetchMyBeerCheckIns(controller.signal).then((items: BeerCheckIn[] | null) => {
      if (controller.signal.aborted) return;
      setLoadFailed(items === null);
    });
    return () => controller.abort();
  }, [diaryToken]);

  const sessions = useMemo(() => allSessionsNewestFirst(current, history), [current, history]);
  const nights = useMemo(() => sessions.filter((s) => s.drinks.length > 0), [sessions]);
  const lastNight = nights[0] ?? null;
  const olderNights = nights.slice(1);

  // ── Lifetime numbers for the sheet. This precedence is lifted verbatim from
  // the old Výkon screen: durable backend numbers win only when they're at
  // least as complete as the local view, so freshly-counted-but-not-yet-synced
  // beers never make the totals appear to shrink.
  const localLifetime = useMemo(() => computeLifetime(sessions), [sessions]);
  const localRecords = useMemo(() => computeRecords(sessions), [sessions]);
  const localPeriods = useMemo(() => computePeriodStats(sessions), [sessions]);
  const localTopPubs = useMemo(() => computeTopPubs(sessions), [sessions]);
  const reconciled = useMemo(
    () => (diarySnapshot ? deriveReconciledDiaryStats(diarySnapshot, sessions) : null),
    [diarySnapshot, sessions],
  );

  const useRemote = remote != null && remote.totalBeers >= localLifetime.totalBeers;

  const lifetime: LifetimeStats = useMemo(
    () =>
      reconciled
        ? {
            // Never below the local count. The reconciled snapshot lags behind
            // beers that haven't synced yet, and with the card and the sheet
            // one tap apart, "11 tonight / 9 ever" reads as a broken product.
            totalBeers: Math.max(reconciled.totalBeers, localLifetime.totalBeers),
            totalEvenings: Math.max(remote?.totalEvenings ?? 0, localLifetime.totalEvenings),
            distinctPubs: Math.max(reconciled.distinctPubs, remote?.distinctPubs ?? 0),
            totalSpentCzk: Math.max(reconciled.totalSpentCzk, localLifetime.totalSpentCzk),
          }
        : useRemote
          ? {
              totalBeers: remote!.totalBeers,
              totalEvenings: remote!.totalEvenings,
              distinctPubs: remote!.distinctPubs,
              totalSpentCzk: remote!.totalSpentCzk,
            }
          : localLifetime,
    [localLifetime, reconciled, remote, useRemote],
  );

  const records: PersonalRecords = useMemo(
    () =>
      useRemote
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
        : localRecords,
    [localRecords, remote, useRemote],
  );

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

  const thisMonth = periodMonths[periodMonths.length - 1] ?? null;

  const statRows: StatRow[] = useMemo(() => {
    const rows: StatRow[] = [
      { key: 'evenings', label: cs.diary.statsEvenings, value: String(lifetime.totalEvenings) },
      { key: 'pubs', label: cs.diary.statsPubs, value: String(lifetime.distinctPubs) },
      {
        key: 'spent',
        label: cs.diary.statsSpent,
        value: formatPrice(lifetime.totalSpentCzk, priceCurrency),
      },
    ];
    if (thisMonth) {
      rows.push({
        key: 'month',
        label: cs.diary.statsThisMonth,
        value: beerCountLabel(thisMonth.beers),
        meta:
          thisMonth.averageBeersPerEvening > 0
            ? cs.diary.statsMonthAvg(thisMonth.averageBeersPerEvening.toLocaleString('cs-CZ'))
            : null,
      });
    }
    // These two used to live in the profile's stats grid. Numbers have exactly
    // one home now, and this is it.
    if (ratingsCount > 0) {
      rows.push({ key: 'ratings', label: cs.diary.statsRatings, value: String(ratingsCount) });
    }
    if (walkedM != null) {
      rows.push({ key: 'walked', label: cs.diary.statsWalked, value: formatWalkedKm(walkedM) });
    }
    return rows;
  }, [lifetime, priceCurrency, ratingsCount, thisMonth, walkedM]);

  const recordRows: StatRow[] = useMemo(() => {
    const fastest = plausibleFastestBeerMs(records.fastestBeerMs);
    return [
      {
        key: 'most',
        label: cs.diary.statsRecordMost,
        value:
          records.mostBeersInEvening > 0
            ? beerCountLabel(records.mostBeersInEvening)
            : cs.diary.statsEmptyValue,
        meta: records.mostBeersPubName,
      },
      {
        key: 'fastest',
        label: cs.diary.statsRecordFastest,
        value: fastest !== null ? cs.stats.pace(fastest) : cs.diary.statsEmptyValue,
      },
      {
        key: 'longest',
        label: cs.diary.statsRecordLongest,
        value:
          records.longestEveningMs !== null
            ? cs.stats.span(records.longestEveningMs)
            : cs.diary.statsEmptyValue,
      },
    ];
  }, [records]);

  // Top five is enough: nobody reads the sixth-favourite pub.
  const pubRows: StatRow[] = useMemo(
    () =>
      topPubs.slice(0, 5).map((pub) => ({
        key: pub.pubKey,
        label: pub.pubName,
        value: beerCountLabel(pub.beers),
      })),
    [topPubs],
  );

  const yearRows: StatRow[] = useMemo(
    () =>
      [...periodYears].reverse().map((year) => ({
        key: year.period,
        label: year.period,
        value: cs.diary.statsYearValue(
          beerCountLabel(year.beers),
          year.averageBeersPerEvening.toLocaleString('cs-CZ'),
        ),
      })),
    [periodYears],
  );

  // ── One nudge, one priority, never two at once.
  const nudge: Nudge | null = useMemo(() => {
    if (loadFailed) {
      return {
        kind: 'counted',
        text: cs.diary.loadFailed,
        undoLabel: cs.diary.retry,
        onUndo: () => {
          setLoadFailed(false);
          setDiaryToken((token) => token + 1);
        },
      };
    }
    if (pendingCount > 0) {
      return { kind: 'dopito', label: cs.diary.queued(pendingCount), onPress: () => undefined };
    }
    return null;
  }, [loadFailed, pendingCount]);

  const openEvening = useCallback(
    (session: TallySession) => {
      router.push({ pathname: '/evening', params: { startedAt: session.startedAt } });
    },
    [router],
  );

  const handleHistoricalSaved = useCallback((_entries: BeerCheckInInput[]) => {
    setDiaryToken((token) => token + 1);
  }, []);

  const lastNoun = lastNight ? nightNoun(lastNight) : null;
  const lastSpentCzk = lastNight ? sessionTotalCzk(lastNight) : 0;
  const isRunning =
    lastNight !== null &&
    current !== null &&
    lastNight.startedAt === current.startedAt &&
    eveningDayRelation(lastNight.startedAt, now) === 'today';

  const topInset = embedded ? 0 : insets.top;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: topInset + 8, paddingBottom: Math.max(insets.bottom, Spacing.sm) },
      ]}
    >
      {/* Embedded in the Štamgast tab the "…" door sits next to the segmented
          control, so a whole 44pt row for one glyph would be dead space. */}
      {statsControlled ? null : (
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Pressable
            onPress={() => setOwnStatsOpen(true)}
            style={({ pressed }) => [styles.moreButton, pressed && styles.pressedSoft]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.diaryStats}
          >
            <MenuIcon size={20} color={Colors.mutedText} />
          </Pressable>
        </View>
      )}

      {lastNight && lastNoun ? (
        // The trail and the fade that ends it share one box, exactly like Parta:
        // an absolute child that overflows its parent gets clipped on Android.
        <View style={styles.body}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <NightCard
              // With nothing under it the card takes the leftover height, exactly
              // like the counter's coaster — a short card with 300pt of empty
              // stout beneath it is the wireframe look, not airy design.
              style={olderNights.length === 0 ? styles.cardGrow : undefined}
              count={lastNoun.count}
              nounLabel={lastNoun.noun}
              whenLabel={
                isRunning
                  ? `${eveningDateLabel(lastNight.startedAt, now)} · ${cs.diary.running}`
                  : eveningDateLabel(lastNight.startedAt, now)
              }
              placeLabel={lastNight.pubName || cs.diary.noPub}
              spentLabel={lastSpentCzk > 0 ? formatPrice(lastSpentCzk, priceCurrency) : null}
              nights={nights.length}
              onPress={() => openEvening(lastNight)}
              accessibilityLabel={cs.a11y.diaryCard(
                beerCountLabel(lastNoun.count),
                lastNight.pubName || cs.diary.noPub,
                eveningDateLabel(lastNight.startedAt, now),
              )}
            />

            {olderNights.length > 0 ? (
              <>
                <Text style={styles.olderHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.diary.olderHeader}
                </Text>
                <View style={styles.rowsCard}>
                  {olderNights.map((session, index) => (
                    <NightRow
                      key={session.startedAt}
                      session={session}
                      priceCurrency={priceCurrency}
                      now={now}
                      isFirst={index === 0}
                      onPress={() => openEvening(session)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
          <ScrollFade />
        </View>
      ) : (
        <View style={styles.empty}>
          <TallyCoaster marks={0} nights={0} width={96} />
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.diary.emptyTitle}
          </Text>
          <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.diary.emptyBody}
          </Text>
        </View>
      )}

      {/* Like Parta: this screen scrolls, so it does not get the counter's 84pt
          hero button with a second line under it — that pair ate a third of the
          screen the trail needs. One 62pt GlowButton, the non-hero variant. */}
      <View style={styles.footer}>
        <NudgeSlot nudge={nudge} collapseWhenEmpty />

        <GlowButton
          label={cs.diary.cta}
          onPress={() => setHistoricalOpen(true)}
          glow="soft"
          accessibilityLabel={cs.a11y.myBeersAddHistorical}
        />
      </View>

      <DiaryStatsSheet
        visible={statsVisible}
        totalBeers={lifetime.totalBeers.toLocaleString('cs-CZ')}
        rows={statRows}
        records={recordRows}
        topPubs={pubRows}
        years={yearRows}
        onClose={closeStats}
      />

      <HistoricalBeerEntrySheet
        visible={historicalOpen}
        onClose={() => setHistoricalOpen(false)}
        onSaved={handleHistoricalSaved}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Only ONE flex: 1 child (the scroll), so nothing fights for the space and
  // the button stays exactly where the thumb left it.
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 8,
  },
  headerSpacer: { flex: 1, minWidth: Spacing.sm },
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedSoft: { opacity: 0.6 },

  body: { flex: 1 },
  footer: { gap: 12 },
  scroll: { flex: 1 },
  // flexGrow gives the content container a definite height, which is what lets
  // a lone card claim the leftover space instead of collapsing to its minimum.
  // Enough room under the last row that it can scroll clear of the button
  // instead of resting permanently cut in half.
  scrollContent: { flexGrow: 1, paddingBottom: Spacing.lg },
  cardGrow: { flex: 1 },

  // Quiet, lower-case, no amber: a label for the list, not a headline of its own.
  olderHeader: {
    marginTop: 24,
    marginBottom: 8,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  rowsCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingVertical: 4,
    overflow: 'hidden',
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
    includeFontPadding: false,
  },
  rowMeta: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  // The empty state keeps the same pinned button as the full one, so the action
  // never moves between states.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  emptyBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
