/**
 * "Soukromý pivní deník" — your own history, reached from Profil.
 *
 * Four blocks and nothing else:
 *
 *   1. the last night as one hero card — big amber numeral and the three facts
 *      the number cannot hold (`NightCard`),
 *   2. every older night, and every manually back-dated beer, as two plain
 *      chronologies on the stout ground, separated by `SectionBreak` (§4.1),
 *   3. one nudge slot, fixed height, at most one message,
 *   4. ONE amber button: "Dopiš večer".
 *
 * Every lifetime number — records, totals, months, years, top pubs — lives one
 * tap deep in the "Kolik jich už bylo?" sheet behind the "…" in the header.
 * Rating a pub and mapping it are gone from this surface on purpose: both
 * already exist in the evening detail (`EveningDetailScreen`), and two paths to
 * one thing was the single worst habit of the old screens.
 *
 * The 3.0 pass changed how it reads, not what it holds. The bordered "list card"
 * that wrapped the rows was a frame inside a frame (§14.10) and made a personal
 * chronology look like a settings table; rows now lie on the ground the way the
 * profile's records do, so the diary reads as the next screen of Profil rather
 * than as a visitor from 2.x. Private and not-yet-delivered rows are marked —
 * discreetly, but unmistakably.
 *
 * Read-only over the counter's data (tallyStore) exactly like its predecessors,
 * so it can never break counting, and it works offline and without an account.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { beerCountLabel, beerNoun, czechPlural } from '@/i18n/plural';
import { formatPrice } from '@/utils/currency';
import {
  ChevronRightIcon,
  ClockIcon,
  LockKeyholeIcon,
  MenuIcon,
  TriangleAlertIcon,
} from '@/components/shared/IconGlyph';
import { MockLayout } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import type { Stat } from '@/mocks/StatGrid';

import { NightCard } from '@/diary/NightCard';
import { TallyCoaster } from '@/diary/TallyCoaster';
import { DiaryStatsSheet, type StatRow } from '@/diary/DiaryStatsSheet';
import { mergeDiaryCheckIns } from '@/diary/diaryCheckIns';

import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { GlowButton } from '@/components/shared/GlowButton';
import { ScrollFade } from '@/components/shared/ScrollFade';

import { fetchMyBeerCheckIns, type BeerCheckIn, type BeerCheckInInput } from '@/data/beerCheckinsClient';
import { getPendingBeerCheckIns } from '@/data/beerCheckinsQueue';
import { deriveReconciledDiaryStats } from '@/data/diarySync';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { useSettingsStore } from '@/stores/settingsStore';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
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

/**
 * The three facts under the hero numeral: what the night cost, how long it ran
 * and how fast it went. Deliberately three even when one of them is unknown —
 * a column that appears and disappears makes two nights unreadable against each
 * other, and an em dash is an honest answer for a night with no prices on it.
 */
function nightFacts(session: TallySession, priceCurrency: PriceCurrency): Stat[] {
  const spentCzk = sessionTotalCzk(session);
  const stamps = session.drinks
    .map((drink) => Date.parse(drink.at))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  const spanMs = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
  const beers = beerCount(session);
  // Pace is the gap BETWEEN beers, so one beer has no pace and two have one gap.
  const paceMs = beers > 1 && spanMs > 0 ? spanMs / (beers - 1) : 0;

  return [
    {
      label: cs.diary.factSpent,
      value: spentCzk > 0 ? formatPrice(spentCzk, priceCurrency) : cs.diary.factEmpty,
    },
    {
      label: cs.diary.factSpan,
      value: spanMs > 0 ? cs.stats.span(spanMs) : cs.diary.factEmpty,
    },
    {
      label: cs.diary.factPace,
      value: paceMs > 0 ? cs.stats.pace(paceMs) : cs.diary.factEmpty,
    },
  ];
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

/**
 * The discreet end of a row: a lock when the entry is yours alone, a clock while
 * it is still sitting in the offline queue. Glyphs, not chips — a row of labels
 * would shout a state that is true of most of this screen most of the time, and
 * the marker still has to be unambiguous rather than loud.
 */
function RowTags({ isPrivate, isQueued }: { isPrivate: boolean; isQueued: boolean }) {
  if (!isPrivate && !isQueued) return null;
  return (
    <View style={styles.rowTags}>
      {isQueued ? (
        <ClockIcon size={15} color={Colors.mutedText} />
      ) : null}
      {isPrivate ? <LockKeyholeIcon size={15} color={Colors.mutedText} /> : null}
    </View>
  );
}

function shortHistoricalDate(startIso: string, endIso?: string | null): string {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return '';
  const start = new Date(startMs);
  const date = start.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
  const startTime = start.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const endMs = endIso ? Date.parse(endIso) : Number.NaN;
  if (!Number.isFinite(endMs)) return `${date} ${startTime}`;
  const end = new Date(endMs);
  const endTime = end.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${startTime}–${endTime}${end.toDateString() !== start.toDateString() ? ' +1' : ''}`;
}

function historicalMeta(checkIn: BeerCheckIn, priceCurrency: PriceCurrency): string {
  const quantity = Math.max(1, Math.floor(checkIn.quantity || 1));
  return cs.diary.nightMeta([
    quantity > 1 ? `${quantity}×` : '',
    checkIn.priceCzk != null ? formatPrice(checkIn.priceCzk * quantity, priceCurrency) : '',
    checkIn.pubName || cs.myBeers.historicalNoPub,
    shortHistoricalDate(checkIn.checkedInAt, checkIn.endedAt),
  ]);
}

function optimisticCheckIn(input: BeerCheckInInput): BeerCheckIn {
  const now = new Date().toISOString();
  return {
    id: input.clientId,
    account: {
      id: '',
      nickname: null,
      displayName: '',
      avatarUrl: null,
      isPublic: false,
    },
    clientId: input.clientId,
    beerName: input.beerName,
    breweryName: input.breweryName ?? '',
    beerStyle: input.beerStyle ?? '',
    abv: input.abv ?? null,
    quantity: input.quantity ?? 1,
    priceCzk: input.priceCzk ?? null,
    rating: input.rating ?? null,
    note: input.note ?? '',
    tags: input.tags ?? [],
    pubCacheKey: input.pubCacheKey ?? '',
    pubName: input.pubName ?? '',
    pubCity: input.pubCity ?? '',
    visitClientId: input.visitClientId ?? null,
    visibility: input.visibility,
    checkedInAt: input.checkedInAt ?? now,
    endedAt: input.endedAt ?? null,
    reactions: { cheers: 0 },
    myReaction: null,
    createdAt: now,
    updatedAt: now,
  };
}

interface DiaryCheckInState {
  owner: string;
  pendingCount: number;
  loadFailed: boolean;
  remote: BeerCheckIn[];
  pending: BeerCheckIn[];
}

function emptyCheckInState(owner: string): DiaryCheckInState {
  return {
    owner,
    pendingCount: 0,
    loadFailed: false,
    remote: [],
    pending: [],
  };
}

function HistoricalCheckInRow({
  checkIn,
  priceCurrency,
  isFirst,
  isQueued,
  onPress,
}: {
  checkIn: BeerCheckIn;
  priceCurrency: PriceCurrency;
  isFirst: boolean;
  /** Still in the offline queue: written down here, not yet on the server. */
  isQueued: boolean;
  onPress: () => void;
}) {
  const meta = historicalMeta(checkIn, priceCurrency);
  const isPrivate = checkIn.visibility === 'private';
  // The markers are glyphs on screen, so the words go to the screen reader.
  const spokenMeta = cs.diary.nightMeta([
    meta,
    isPrivate ? cs.diary.privateTag : '',
    isQueued ? cs.diary.queuedTag : '',
  ]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !isFirst && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.myBeersDiaryEntry(checkIn.beerName, spokenMeta)}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {checkIn.beerName}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {meta}
        </Text>
      </View>
      <RowTags isPrivate={isPrivate} isQueued={isQueued} />
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export interface DiaryScreenProps {
  embedded?: boolean;
  /** Room for absolutely positioned bottom chrome, such as the 3.0 tab bar. */
  bottomInset?: number;
  /** Set by the host (BeerScreen) when the "…" door sits in its header row
   *  instead of ours; leaving it undefined keeps the screen self-contained. */
  statsOpen?: boolean;
  onStatsClose?: () => void;
}

export default function DiaryScreen({
  embedded = false,
  bottomInset = 0,
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
  const signedIn = useAccountStore(selectIsSignedIn);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
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
  const [diaryToken, setDiaryToken] = useState(0);
  const checkInOwner = accountId ?? 'local';
  const [checkInState, setCheckInState] = useState<DiaryCheckInState>(() =>
    emptyCheckInState(checkInOwner),
  );
  const activeCheckIns = useMemo(
    () =>
      checkInState.owner === checkInOwner
        ? checkInState
        : emptyCheckInState(checkInOwner),
    [checkInOwner, checkInState],
  );

  // Manual historical entries use the released beer-check-in API and its
  // offline queue. Keep both sources on this surface: a queued row must appear
  // immediately and remain visible until the server returns that client id.
  useEffect(() => {
    const controller = new AbortController();
    void getPendingBeerCheckIns().then((pending) => {
      if (controller.signal.aborted) return;
      setCheckInState((current) => {
        const base = current.owner === checkInOwner ? current : emptyCheckInState(checkInOwner);
        return {
          ...base,
          pendingCount: pending.length,
          pending: pending.map(optimisticCheckIn),
        };
      });
    });
    // No-account mode owns only local/queued data. A missing account is not a
    // network failure and must not turn the offline diary into an error state.
    if (!signedIn) return () => controller.abort();
    void fetchMyBeerCheckIns(controller.signal).then((items: BeerCheckIn[] | null) => {
      if (controller.signal.aborted) return;
      setCheckInState((current) => {
        const base = current.owner === checkInOwner ? current : emptyCheckInState(checkInOwner);
        return {
          ...base,
          loadFailed: items === null,
          remote: items ?? [],
        };
      });
    });
    return () => controller.abort();
  }, [checkInOwner, diaryToken, signedIn]);

  const visibleCheckIns = useMemo(
    () => mergeDiaryCheckIns(activeCheckIns.pending, activeCheckIns.remote),
    [activeCheckIns.pending, activeCheckIns.remote],
  );

  // A queued row looked exactly like a delivered one, so an offline diary was
  // indistinguishable from a synced one. The merge keeps a pending row until the
  // server returns its client id, so this set IS "written here, not sent yet".
  const queuedIds = useMemo(
    () => new Set(activeCheckIns.pending.map((item) => item.clientId || item.id)),
    [activeCheckIns.pending],
  );

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

  // The lifetime block is a grid, not a table of label→value rows: these are
  // the numbers the screen exists to hand back, and they read as a balance
  // rather than as an export when they arrive as figures first (§3, StatGrid).
  const totalsStats: Stat[] = useMemo(() => {
    const stats: Stat[] = [
      { label: cs.diary.statsEvenings, value: String(lifetime.totalEvenings) },
      { label: cs.diary.statsPubs, value: String(lifetime.distinctPubs) },
      { label: cs.diary.statsSpent, value: formatPrice(lifetime.totalSpentCzk, priceCurrency) },
    ];
    // These two used to live in the profile's stats grid. Numbers have exactly
    // one home now, and this is it.
    if (ratingsCount > 0) {
      stats.push({ label: cs.diary.statsRatings, value: String(ratingsCount) });
    }
    if (walkedM != null) {
      stats.push({ label: cs.diary.statsWalked, value: formatWalkedKm(walkedM) });
    }
    return stats;
  }, [lifetime, priceCurrency, ratingsCount, walkedM]);

  const monthStats: Stat[] | null = useMemo(() => {
    if (!thisMonth) return null;
    const stats: Stat[] = [{ label: cs.diary.statsMonthBeers, value: String(thisMonth.beers) }];
    if (thisMonth.averageBeersPerEvening > 0) {
      stats.push({
        label: cs.diary.statsMonthAvgLabel,
        value: thisMonth.averageBeersPerEvening.toLocaleString('cs-CZ'),
      });
    }
    return stats;
  }, [thisMonth]);

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
        value: beerCountLabel(year.beers),
        meta:
          year.averageBeersPerEvening > 0
            ? cs.diary.statsYearAvg(year.averageBeersPerEvening.toLocaleString('cs-CZ'))
            : null,
      })),
    [periodYears],
  );

  // ── One nudge, one priority, never two at once.
  const nudge: Nudge | null = useMemo(() => {
    if (activeCheckIns.loadFailed) {
      return {
        kind: 'counted',
        // Not the default check: this strip reports a failure, and a tick next
        // to "nenačetl se" is a small lie about what happened.
        icon: TriangleAlertIcon,
        text: cs.diary.loadFailed,
        undoLabel: cs.diary.retry,
        onUndo: () => {
          trackUiInteraction('diary_retry', 'retry');
          setCheckInState((current) => {
            const base =
              current.owner === checkInOwner ? current : emptyCheckInState(checkInOwner);
            return { ...base, loadFailed: false };
          });
          setDiaryToken((token) => token + 1);
        },
      };
    }
    if (activeCheckIns.pendingCount > 0) {
      return {
        kind: 'dopito',
        label: cs.diary.queued(activeCheckIns.pendingCount),
        onPress: () => undefined,
      };
    }
    return null;
  }, [activeCheckIns.loadFailed, activeCheckIns.pendingCount, checkInOwner]);

  const openEvening = useCallback(
    (session: TallySession) => {
      trackUiInteraction('diary_evening_open');
      router.push({ pathname: '/evening', params: { startedAt: session.startedAt } });
    },
    [router],
  );

  const handleHistoricalSaved = useCallback(
    (entries: BeerCheckInInput[]) => {
      setCheckInState((current) => {
        const base = current.owner === checkInOwner ? current : emptyCheckInState(checkInOwner);
        return {
          ...base,
          pending: mergeDiaryCheckIns(entries.map(optimisticCheckIn), base.pending),
          pendingCount: base.pendingCount + entries.length,
        };
      });
      setDiaryToken((token) => token + 1);
    },
    [checkInOwner],
  );

  const lastNoun = lastNight ? nightNoun(lastNight) : null;
  const lastFacts = useMemo(
    () => (lastNight ? nightFacts(lastNight, priceCurrency) : []),
    [lastNight, priceCurrency],
  );
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
        {
          paddingTop: topInset,
          paddingBottom: Math.max(insets.bottom, Spacing.sm) + bottomInset,
        },
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

      {lastNight || visibleCheckIns.length > 0 ? (
        // The trail and the fade that ends it share one box, exactly like Parta:
        // an absolute child that overflows its parent gets clipped on Android.
        <View style={styles.body}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {lastNight && lastNoun ? (
              <NightCard
                count={lastNoun.count}
                nounLabel={lastNoun.noun}
                whenLabel={
                  isRunning
                    ? `${eveningDateLabel(lastNight.startedAt, now)} · ${cs.diary.running}`
                    : eveningDateLabel(lastNight.startedAt, now)
                }
                placeLabel={lastNight.pubName || cs.diary.noPub}
                facts={lastFacts}
                onPress={() => openEvening(lastNight)}
                accessibilityLabel={cs.a11y.diaryCard(
                  beerCountLabel(lastNoun.count),
                  lastNight.pubName || cs.diary.noPub,
                  eveningDateLabel(lastNight.startedAt, now),
                )}
              />
            ) : null}

            {olderNights.length > 0 ? (
              <>
                {/* A band, not a hairline: two chronologies under one hero read
                    as one long list when only margin separates them (§4.1). */}
                <SectionBreak title={cs.diary.olderHeader} inset={MockLayout.screenPad} />
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
              </>
            ) : null}

            {visibleCheckIns.length > 0 ? (
              <>
                <SectionBreak title={cs.diary.manualHeader} inset={MockLayout.screenPad} />
                {visibleCheckIns.map((checkIn, index) => (
                  <HistoricalCheckInRow
                    key={checkIn.clientId || checkIn.id}
                    checkIn={checkIn}
                    priceCurrency={priceCurrency}
                    isFirst={index === 0}
                    isQueued={queuedIds.has(checkIn.clientId || checkIn.id)}
                    onPress={() => {
                      trackUiInteraction('diary_beer_open');
                      router.push({
                        pathname: '/beer-detail',
                        params: {
                          beer: checkIn.beerName,
                          brewery: checkIn.breweryName,
                        },
                      });
                    }}
                  />
                ))}
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
          onPress={() => {
            trackUiInteraction('diary_historical_open');
            setHistoricalOpen(true);
          }}
          glow="soft"
          accessibilityLabel={cs.a11y.myBeersAddHistorical}
        />
      </View>

      <DiaryStatsSheet
        visible={statsVisible}
        totalBeers={lifetime.totalBeers.toLocaleString('cs-CZ')}
        totals={totalsStats}
        month={monthStats}
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
    // One width through the whole app, screen or sheet (§20.1). The sections
    // bleed past it by exactly this much, so it must not be re-added anywhere.
    paddingHorizontal: MockLayout.screenPad,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    marginBottom: 4,
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
  // The bottom pad has to clear `ScrollFade` (28pt) with air to spare. At 20 the
  // last row ended INSIDE the fade, so on a diary short enough not to scroll the
  // final entry was permanently half-dissolved — it read as a rendering bug.
  scrollContent: { flexGrow: 1, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },

  // Rows lie on the ground, not inside a bordered panel: a frame around a list
  // that already sits inside a screen is a frame on a frame (§14.10), and it
  // made a personal chronology read as a settings table. 68 is the two-line
  // minimum from §4.1 — 44 is the minimum for touching, not for reading.
  row: {
    minHeight: MockLayout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.08),
  },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: {
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: -0.2,
    color: Colors.foam,
    includeFontPadding: false,
  },
  rowMeta: {
    fontWeight: '400',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  rowTags: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  // The empty state keeps the same pinned button as the full one, so the action
  // never moves between states. The clean mat is the one illustration this
  // screen earns (§20.12) — it is literally what an empty diary looks like.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  emptyTitle: {
    marginTop: Spacing.xs,
    fontWeight: '800',
    fontSize: 24,
    letterSpacing: -0.4,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  emptyBody: {
    marginTop: -6,
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
